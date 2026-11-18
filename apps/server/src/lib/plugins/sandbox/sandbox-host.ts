// SPDX-License-Identifier: MIT

import { AsyncLocalStorage } from "node:async_hooks";
import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Host side of the plugin sandbox (justflows-ce#270).
 *
 * One child process per plugin and site. The child runs under Node's
 * permission model with an empty environment: it reads only the plugin's
 * folder, the worker file, and the SDK; everything else (files, network,
 * processes, workers, addons, inspector) is denied by Node, not by this code.
 * The host enforces time, memory, and concurrency limits, and restarts a
 * crashed process with a growing delay. A plugin that keeps crashing is
 * stopped.
 *
 * Every `ctx` call the child makes is handed to the broker inside the request
 * context of the invocation that caused it, so it runs for the right site.
 */

export interface SandboxLimits {
  /** V8 heap ceiling for the child, in megabytes. */
  memoryMb: number;
  hookTimeoutMs: number;
  routeTimeoutMs: number;
  lifecycleTimeoutMs: number;
  /** Invocations one process may run at once. More are refused, not queued. */
  maxInFlight: number;
  /** Stop a process that has had nothing to do for this long. */
  idleMs: number;
  /** Crashes or timeouts within `crashWindowMs` that stop the plugin. */
  maxCrashes: number;
  crashWindowMs: number;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  memoryMb: 128,
  hookTimeoutMs: 2_000,
  routeTimeoutMs: 15_000,
  lifecycleTimeoutMs: 30_000,
  maxInFlight: 16,
  idleMs: 10 * 60 * 1000,
  maxCrashes: 5,
  crashWindowMs: 10 * 60 * 1000,
};

/** Sandboxing needs Node's permission model with network control (Node 25 or later). */
export function sandboxSupported(): boolean {
  const flags = process.allowedNodeEnvironmentFlags;
  return flags.has("--permission") && flags.has("--allow-net");
}

export type InvokeKind = "action" | "gate" | "filter" | "route" | "lifecycle";

export interface SandboxRegistration {
  type: "hook" | "route";
  kind: string;
  name: string;
  options: unknown;
  handlerId: number;
}

export interface SandboxSpec {
  pluginId: string;
  version: string;
  siteId: string;
  /** The plugin's installed folder. The only plugin files the child may read. */
  pluginDir: string;
  /** The server entry inside `pluginDir`. */
  entry: string;
  permissions: string[];
  runtime: unknown;
  cacheEnabled: boolean;
  httpBase: string;
  limits?: Partial<SandboxLimits>;
}

/** Runs one `ctx` call for the child. Throwing refuses it. */
export type SandboxBroker = (op: string, args: unknown[]) => Promise<unknown>;

export class SandboxError extends Error {
  constructor(
    message: string,
    readonly code: "timeout" | "crashed" | "busy" | "stopped" | "failed",
  ) {
    super(message);
    this.name = "SandboxError";
  }
}

/** The worker: compiled .js in a build, the TypeScript source in development and tests. */
function workerFile(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const compiled = path.join(here, "sandbox-worker.js");
  return fs.existsSync(compiled) ? compiled : path.join(here, "sandbox-worker.ts");
}

/** Find an installed package's folder by walking up from this file, as Node would. */
function packageDir(name: string, from: string): string | null {
  let dir = from;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name, "package.json");
    if (fs.existsSync(candidate)) return fs.realpathSync(path.dirname(candidate));
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function importEntry(dir: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
      exports?: unknown;
      module?: string;
      main?: string;
    };
    const root = (pkg.exports as Record<string, unknown> | undefined)?.["."] ?? pkg.exports;
    const fromExports =
      typeof root === "string"
        ? root
        : typeof (root as Record<string, unknown> | undefined)?.import === "string"
          ? ((root as Record<string, string>).import as string)
          : typeof ((root as Record<string, Record<string, unknown>> | undefined)?.import as Record<string, unknown> | undefined)?.default === "string"
            ? (((root as Record<string, Record<string, string>>).import as Record<string, string>).default as string)
            : null;
    const relative = fromExports ?? pkg.module ?? pkg.main ?? "index.js";
    return path.join(dir, relative);
  } catch {
    return null;
  }
}

interface ModuleAccess {
  /** Bare specifier → file URL for the worker's resolve hook. */
  modules: Record<string, string>;
  /** Folders the child may read. */
  readable: string[];
}

let cachedAccess: ModuleAccess | null = null;

/** The SDK and the packages it imports, resolved once by the host. */
export function sandboxModuleAccess(): ModuleAccess {
  if (cachedAccess) return cachedAccess;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const modules: Record<string, string> = {};
  const readable: string[] = [];
  const sdk = packageDir("@justflows/sdk", here);
  if (sdk) {
    const entry = importEntry(sdk);
    if (entry) modules["@justflows/sdk"] = pathToFileURL(entry).href;
    readable.push(sdk);
    const zod = packageDir("zod", sdk);
    if (zod) {
      const zodEntry = importEntry(zod);
      if (zodEntry) modules.zod = pathToFileURL(zodEntry).href;
      readable.push(zod);
    }
  }
  cachedAccess = { modules, readable };
  return cachedAccess;
}

interface Waiter {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  /** Request context of the code that invoked this handler. */
  snapshot: <R>(fn: () => R) => R;
}

/** One plugin on one site, in its own process. */
export class SandboxProcess {
  readonly limits: SandboxLimits;
  private child: ChildProcess | null = null;
  private starting: Promise<SandboxRegistration[]> | null = null;
  private registrations: SandboxRegistration[] | null = null;
  private readonly waiters = new Map<number, Waiter>();
  private nextInvokeId = 1;
  private startSnapshot: (<R>(fn: () => R) => R) | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private crashes: number[] = [];
  private stopped = false;
  private stderrBytes = 0;

  constructor(
    readonly spec: SandboxSpec,
    private readonly broker: SandboxBroker,
    private readonly onEvent: (event: { type: "unsubscribe"; handlerId: number } | { type: "log"; text: string } | { type: "crashed"; reason: string }) => void = () => undefined,
  ) {
    this.limits = { ...DEFAULT_SANDBOX_LIMITS, ...spec.limits };
  }

  /** The child's process id while it runs. For tests and diagnostics. */
  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  /** Start the process and run the plugin's activate(). Returns what it registered. */
  start(): Promise<SandboxRegistration[]> {
    if (this.stopped) return Promise.reject(new SandboxError("This sandbox was stopped", "stopped"));
    if (this.child && this.registrations) return Promise.resolve(this.registrations);
    if (this.starting) return this.starting;
    this.startSnapshot = AsyncLocalStorage.snapshot();
    this.starting = this.spawn().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private spawn(): Promise<SandboxRegistration[]> {
    const access = sandboxModuleAccess();
    const worker = workerFile();
    const pluginDir = fs.realpathSync(this.spec.pluginDir);
    const entry = fs.realpathSync(this.spec.entry);
    const relative = path.relative(pluginDir, entry);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return Promise.reject(new SandboxError("The plugin entry is outside its folder", "failed"));
    }
    const readable = [pluginDir, worker, ...access.readable];
    const child = fork(worker, [], {
      cwd: pluginDir,
      /** Replaces the host's own flags (such as a TypeScript loader); nothing is inherited. */
      execArgv: [
        "--permission",
        ...readable.map((item) => `--allow-fs-read=${item}`),
        `--max-old-space-size=${this.limits.memoryMb}`,
        "--stack-size=984",
      ],
      env: { NODE_ENV: process.env.NODE_ENV === "production" ? "production" : "development" },
      serialization: "json",
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    this.child = child;
    const forward = (chunk: Buffer) => {
      if (this.stderrBytes > 64 * 1024) return;
      this.stderrBytes += chunk.length;
      this.onEvent({ type: "log", text: chunk.toString("utf8").slice(0, 4000) });
    };
    child.stdout?.on("data", forward);
    child.stderr?.on("data", forward);

    return new Promise<SandboxRegistration[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.kill("timeout");
        reject(new SandboxError("The sandboxed plugin took too long to start", "timeout"));
      }, this.limits.lifecycleTimeoutMs);
      const settle = (fn: () => void) => {
        clearTimeout(timer);
        fn();
      };
      child.on("message", (raw: unknown) => {
        const message = raw as { type?: string; registrations?: SandboxRegistration[]; error?: string };
        if (message.type === "ready") {
          const registrations = Array.isArray(message.registrations) ? message.registrations.filter(validRegistration) : [];
          this.registrations = registrations;
          settle(() => resolve(registrations));
          this.touch();
        } else if (message.type === "failed") {
          settle(() => reject(new SandboxError(`The sandboxed plugin failed to start: ${String(message.error ?? "")}`, "failed")));
          this.kill("failed");
        } else {
          this.handleMessage(child, raw);
        }
      });
      child.on("exit", (code, signal) => {
        settle(() => reject(new SandboxError(`The sandboxed plugin exited (${signal ?? code})`, "crashed")));
        this.onExit(child, signal ?? String(code));
      });
      child.on("error", (error) => {
        settle(() => reject(new SandboxError(`The sandbox could not start: ${error.message}`, "failed")));
      });
      child.send({
        type: "init",
        entry,
        pluginId: this.spec.pluginId,
        version: this.spec.version,
        runtime: this.spec.runtime,
        permissions: this.spec.permissions,
        modules: access.modules,
        cacheEnabled: this.spec.cacheEnabled,
        httpBase: this.spec.httpBase,
      });
    });
  }

  private handleMessage(child: ChildProcess, raw: unknown): void {
    if (child !== this.child) return;
    const message = raw as { type?: string; id?: number; ok?: boolean; value?: unknown; error?: string; op?: string; args?: unknown; via?: number; handlerId?: number };
    if (message.type === "result" && typeof message.id === "number") {
      const waiter = this.waiters.get(message.id);
      if (!waiter) return;
      this.waiters.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.ok) waiter.resolve(message.value);
      else waiter.reject(new Error(String(message.error ?? "The sandboxed handler failed")));
      this.touch();
      return;
    }
    if (message.type === "call" && typeof message.id === "number" && typeof message.op === "string") {
      const id = message.id;
      const args = Array.isArray(message.args) ? message.args : [];
      /** A call made while handling an invocation runs in that request; anything else in the start context. */
      const snapshot = (typeof message.via === "number" && this.waiters.get(message.via)?.snapshot) || this.startSnapshot || ((fn) => fn());
      snapshot(() => this.broker(message.op!, args)).then(
        (value) => this.reply(child, { type: "reply", id, ok: true, value }),
        (error: unknown) => this.reply(child, { type: "reply", id, ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
      return;
    }
    if (message.type === "unsubscribe" && typeof message.handlerId === "number") {
      this.onEvent({ type: "unsubscribe", handlerId: message.handlerId });
      return;
    }
    if (message.type === "crashed") {
      this.onEvent({ type: "crashed", reason: String(message.error ?? "") });
    }
  }

  private reply(child: ChildProcess, message: unknown): void {
    if (child === this.child && child.connected) child.send(message as Parameters<ChildProcess["send"]>[0]);
  }

  /** Run one registered handler (or a lifecycle method) in the child. */
  async invoke(kind: InvokeKind, handlerId: number, args: unknown[], name?: string): Promise<unknown> {
    await this.start();
    const child = this.child;
    if (!child || !child.connected) throw new SandboxError("The sandboxed plugin is not running", "crashed");
    if (this.waiters.size >= this.limits.maxInFlight) throw new SandboxError("The sandboxed plugin is busy", "busy");
    const id = this.nextInvokeId++;
    const timeout =
      kind === "route" ? this.limits.routeTimeoutMs : kind === "lifecycle" ? this.limits.lifecycleTimeoutMs : this.limits.hookTimeoutMs;
    const snapshot = AsyncLocalStorage.snapshot();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new SandboxError(`The sandboxed plugin did not answer within ${timeout} ms`, "timeout"));
        /** A handler that does not answer may be stuck in a loop: stop the whole process. */
        this.kill("timeout");
      }, timeout);
      this.waiters.set(id, { resolve, reject, timer, snapshot });
      child.send({ type: "invoke", id, kind, handlerId, args, ...(name ? { name } : {}) });
    });
  }

  /** Kill the process and forget it at once, so the next call starts a fresh one. */
  private kill(reason: string): void {
    const child = this.child;
    if (!child) return;
    if (reason === "timeout") this.recordCrash();
    this.detach(child, reason);
    child.kill("SIGKILL");
  }

  private recordCrash(): void {
    const now = Date.now();
    this.crashes = [...this.crashes.filter((at) => now - at < this.limits.crashWindowMs), now];
    if (this.crashes.length >= this.limits.maxCrashes) {
      this.stopped = true;
      this.onEvent({ type: "crashed", reason: `stopped after ${this.crashes.length} failures` });
    }
  }

  private onExit(child: ChildProcess, reason: string): void {
    if (child !== this.child) return;
    this.detach(child, reason);
    if (reason !== "SIGKILL" && reason !== "0" && reason !== "SIGTERM") this.recordCrash();
  }

  /** Forget a process and fail whatever it was still running. */
  private detach(child: ChildProcess, reason: string): void {
    if (child !== this.child) return;
    this.child = null;
    this.registrations = null;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    for (const [id, waiter] of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new SandboxError(`The sandboxed plugin exited (${reason})`, "crashed"));
      this.waiters.delete(id);
    }
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.waiters.size === 0) this.child?.kill("SIGTERM");
    }, this.limits.idleMs);
    this.idleTimer.unref();
  }

  /** Stop the process for good. */
  stop(): void {
    this.stopped = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.child?.kill("SIGKILL");
  }

  /** True after too many crashes or an explicit stop. */
  get isStopped(): boolean {
    return this.stopped;
  }
}

function validRegistration(value: unknown): value is SandboxRegistration {
  const item = value as SandboxRegistration | null;
  return (
    !!item &&
    (item.type === "hook" || item.type === "route") &&
    typeof item.kind === "string" &&
    typeof item.name === "string" &&
    item.name.length <= 500 &&
    Number.isSafeInteger(item.handlerId)
  );
}
