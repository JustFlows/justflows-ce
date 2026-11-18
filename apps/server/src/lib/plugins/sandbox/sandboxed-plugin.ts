// SPDX-License-Identifier: MIT

import type { PluginContext, PluginHttpRequest, PluginHttpResponse, PluginManifest, PluginModule } from "@justflows/sdk";
import { SandboxError, SandboxProcess, type InvokeKind, type SandboxLimits, type SandboxRegistration } from "./sandbox-host.js";

/**
 * A plugin that runs in the sandbox, presented to the plugin loader as an
 * ordinary module (justflows-ce#270). Its code is never imported into the
 * server process.
 *
 * `activate` starts the plugin's process for the current site and registers a
 * stand-in for every hook and route the plugin registered. A stand-in finds
 * the process for the site of the request it runs in (one process per plugin
 * and site) and invokes the plugin's handler there.
 *
 * The plugin's `ctx` calls are carried out on the host's own `ctx` for this
 * plugin, so manifest permissions and site scope are enforced as they are for
 * any plugin, and only for the site whose process asked. Only the namespaces
 * listed in BROKERED_OPS cross the boundary; the rest are refused.
 */

const MAX_CALL_BYTES = 1024 * 1024;

/** `ctx` calls a sandboxed plugin can make. Everything else is refused. */
export const BROKERED_OPS = [
  "log",
  "settings.get",
  "settings.set",
  "settings.delete",
  "data.list",
  "data.get",
  "data.put",
  "data.delete",
  "data.cas",
  "data.clear",
  "cache.get",
  "cache.set",
  "cache.delete",
  "cache.invalidate",
  "secrets.get",
  "secrets.set",
  "secrets.has",
  "secrets.delete",
  "hooks.emit",
  "hooks.apply",
  "hooks.check",
] as const;

const BROKERED = new Set<string>(BROKERED_OPS);

export interface SandboxedPluginOptions {
  manifest: PluginManifest;
  pluginDir: string;
  entry: string;
  /** The site of the code running now, or null outside any request. */
  currentSiteId: () => string | null;
  /** The site to use when nothing is running for a request (boot). */
  defaultSiteId: () => Promise<string | null>;
  limits?: Partial<SandboxLimits>;
  report?: (context: string, error: unknown) => void;
}

function stringArg(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 500) throw new Error(`${name} must be a short string`);
  return value;
}

/** Run one brokered call on the host's `ctx`. */
export async function runBrokeredCall(host: PluginContext, op: string, args: unknown[]): Promise<unknown> {
  if (!BROKERED.has(op)) throw new Error(`${op} is not available to sandboxed plugins`);
  if (JSON.stringify(args ?? []).length > MAX_CALL_BYTES) throw new Error("The call is too large");
  switch (op) {
    case "log": {
      const level = ["debug", "info", "warn", "error"].includes(String(args[0])) ? (String(args[0]) as "debug" | "info" | "warn" | "error") : "info";
      host.logger[level](String(args[1] ?? "").slice(0, 2000), (args[2] ?? undefined) as Record<string, unknown> | undefined);
      return null;
    }
    case "settings.get":
      return host.settings.get(stringArg(args[0], "key"));
    case "settings.set":
      return host.settings.set(stringArg(args[0], "key"), args[1]);
    case "settings.delete":
      return host.settings.delete(stringArg(args[0], "key"));
    case "data.list":
      return host.data.list(stringArg(args[0], "collection"));
    case "data.get":
      return host.data.get(stringArg(args[0], "collection"), stringArg(args[1], "id"));
    case "data.put":
      return host.data.put(stringArg(args[0], "collection"), stringArg(args[1], "id"), args[2]);
    case "data.delete":
      return host.data.delete(stringArg(args[0], "collection"), stringArg(args[1], "id"));
    case "data.cas":
      return host.data.cas(stringArg(args[0], "collection"), stringArg(args[1], "id"), stringArg(args[2], "expectedUpdatedAt"), args[3]);
    case "data.clear":
      return host.data.clear();
    case "cache.get":
      return (await host.cache.get(stringArg(args[0], "key"))) ?? null;
    case "cache.set":
      return host.cache.set(stringArg(args[0], "key"), args[1], typeof args[2] === "number" ? args[2] : undefined);
    case "cache.delete":
      return host.cache.delete(stringArg(args[0], "key"));
    case "cache.invalidate":
      return host.cache.invalidate(typeof args[0] === "string" ? args[0] : undefined);
    case "secrets.get":
      return (await host.secrets.get(stringArg(args[0], "key"))) ?? null;
    case "secrets.set":
      return host.secrets.set(stringArg(args[0], "key"), String(args[1] ?? ""));
    case "secrets.has":
      return host.secrets.has(stringArg(args[0], "key"));
    case "secrets.delete":
      return host.secrets.delete(stringArg(args[0], "key"));
    case "hooks.emit":
      return host.hooks.emit(stringArg(args[0], "hook") as never, args[1] as never);
    case "hooks.apply":
      return host.hooks.apply(stringArg(args[0], "hook") as never, args[1] as never, args[2] as never);
    case "hooks.check":
      return host.hooks.check(stringArg(args[0], "hook") as never, args[1] as never);
    default:
      throw new Error(`${op} is not available to sandboxed plugins`);
  }
}

/** The request as plain data. Cookies and authorization were already removed by the host. */
function wireRequest(req: PluginHttpRequest): Record<string, unknown> {
  return {
    method: req.method,
    path: req.path,
    query: req.query,
    params: req.params,
    body: req.body,
    headers: req.headers,
    session: req.session,
    ...(req.rawBody !== undefined ? { rawBody: req.rawBody } : {}),
    ...(req.trustedOrigin !== undefined ? { trustedOrigin: req.trustedOrigin } : {}),
    ...(req.locale !== undefined ? { locale: req.locale } : {}),
  };
}

function wireResponse(value: unknown): PluginHttpResponse {
  if (!value || typeof value !== "object") return { status: 204 };
  const response = value as PluginHttpResponse & { body?: unknown };
  const body = response.body as { type?: string; data?: unknown } | undefined;
  if (body && body.type === "Buffer" && Array.isArray(body.data)) {
    return { ...response, body: Buffer.from(body.data as number[]) };
  }
  return response;
}

function signature(registrations: SandboxRegistration[]): string {
  return JSON.stringify(registrations.map((item) => [item.type, item.kind, item.name, item.handlerId]));
}

export function createSandboxedPluginModule(options: SandboxedPluginOptions): PluginModule {
  const { manifest } = options;
  const processes = new Map<string, SandboxProcess>();
  let host: PluginContext | null = null;
  let activationSite: string | null = null;
  let baseline: string | null = null;
  const unsubscribers = new Map<number, () => void>();

  const report = (context: string, error: unknown) => options.report?.(context, error);

  function processFor(siteId: string): SandboxProcess {
    const existing = processes.get(siteId);
    if (existing && !existing.isStopped) return existing;
    if (!host) throw new SandboxError("The sandboxed plugin is not active", "stopped");
    const hostCtx = host;
    const created = new SandboxProcess(
      {
        pluginId: manifest.id,
        version: manifest.version,
        siteId,
        pluginDir: options.pluginDir,
        entry: options.entry,
        permissions: [...hostCtx.permissions],
        runtime: hostCtx.runtime,
        cacheEnabled: hostCtx.cache.enabled,
        httpBase: hostCtx.http.url(""),
        ...(options.limits ? { limits: options.limits } : {}),
      },
      async (op, args) => {
        /** A process only ever acts for its own site. */
        const running = options.currentSiteId();
        if (running && running !== siteId) throw new Error("This call is not for this plugin's site");
        return runBrokeredCall(hostCtx, op, args);
      },
      (event) => {
        if (event.type === "unsubscribe" && siteId === activationSite) unsubscribers.get(event.handlerId)?.();
        else if (event.type === "log") console.warn(`[plugin-sandbox] ${manifest.id}:`, JSON.stringify(event.text.slice(0, 2000)));
        else if (event.type === "crashed") report("sandbox", new Error(`Sandboxed plugin stopped: ${event.reason}`));
      },
    );
    processes.set(siteId, created);
    return created;
  }

  /** Invoke a handler in the process for the site of the running request. */
  async function invoke(kind: InvokeKind, handlerId: number, args: unknown[]): Promise<unknown> {
    const siteId = options.currentSiteId() ?? activationSite;
    if (!siteId) throw new SandboxError("No site for this sandboxed call", "failed");
    const sandbox = processFor(siteId);
    const registrations = await sandbox.start();
    /** Handler ids are positional; a plugin that registers differently per site is refused. */
    if (signature(registrations) !== baseline) {
      throw new SandboxError("The sandboxed plugin registered different hooks or routes on this site", "failed");
    }
    return sandbox.invoke(kind, handlerId, args);
  }

  function registerStandIns(hostCtx: PluginContext, registrations: SandboxRegistration[]): void {
    for (const item of registrations) {
      const id = item.handlerId;
      const hookOptions = item.options && typeof item.options === "object" ? (item.options as Record<string, unknown>) : undefined;
      if (item.type === "hook") {
        let dispose: (() => void) | undefined;
        if (item.kind === "action") {
          dispose = hostCtx.hooks.action(item.name as never, (async (event: unknown, context: unknown) => {
            await invoke("action", id, [event, context]);
          }) as never, hookOptions as never);
        } else if (item.kind === "filter") {
          dispose = hostCtx.hooks.filter(item.name as never, ((value: unknown, context: unknown, hookContext: unknown) =>
            invoke("filter", id, [value, context, hookContext])) as never, hookOptions as never);
        } else if (item.kind === "gate") {
          dispose = hostCtx.hooks.gate(item.name as never, (async (event: { cancel(reason: string): void }, context: unknown) => {
            const result = (await invoke("gate", id, [event, context])) as { cancelled?: string | null } | null;
            if (result?.cancelled) event.cancel(String(result.cancelled));
          }) as never, hookOptions as never);
        }
        if (dispose) unsubscribers.set(id, dispose);
      } else {
        const method = item.kind.toLowerCase();
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        const register = hostCtx.http[method as "get"].bind(hostCtx.http);
        register(item.name, async (req) => wireResponse(await invoke("route", id, [wireRequest(req)])), hookOptions as never);
      }
    }
  }

  async function lifecycle(name: "deactivate" | "provision" | "deleteData"): Promise<void> {
    const siteId = options.currentSiteId() ?? (await options.defaultSiteId());
    if (!siteId) return;
    const sandbox = processFor(siteId);
    await sandbox.start();
    await sandbox.invoke("lifecycle", 0, [], name);
  }

  return {
    manifest,
    async activate(hostCtx) {
      host = hostCtx;
      activationSite = options.currentSiteId() ?? (await options.defaultSiteId());
      if (!activationSite) throw new Error("No site to start the sandboxed plugin for");
      const registrations = await processFor(activationSite).start();
      baseline = signature(registrations);
      registerStandIns(hostCtx, registrations);
    },
    async provision(hostCtx) {
      host ??= hostCtx;
      await lifecycle("provision");
    },
    async deactivate() {
      try {
        await lifecycle("deactivate");
      } catch (error) {
        report("deactivate", error);
      }
      for (const sandbox of processes.values()) sandbox.stop();
      processes.clear();
      unsubscribers.clear();
      host = null;
      baseline = null;
    },
    async deleteData(hostCtx) {
      host ??= hostCtx;
      await lifecycle("deleteData");
    },
  };
}
