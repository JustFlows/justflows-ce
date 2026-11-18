// SPDX-License-Identifier: MIT

/**
 * The plugin sandbox's child process (justflows-ce#270).
 *
 * The host starts this file with Node's permission model: it can read only the
 * plugin's own folder, this file, and the SDK; it cannot write files, open
 * network connections, start processes or workers, load addons, or use the
 * inspector. Its environment holds nothing from the host. The plugin reaches
 * the host only through `ctx`, and every `ctx` call is a message the host's
 * broker answers on the host's terms.
 *
 * This file imports only Node built-ins and uses only syntax Node can strip,
 * so it runs as TypeScript in development and as the compiled .js in builds.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { isBuiltin, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

type HookKind = "action" | "gate" | "filter";
type InvokeKind = HookKind | "route" | "lifecycle";
type AnyFn = (...args: any[]) => any;

interface InitMessage {
  type: "init";
  entry: string;
  pluginId: string;
  version: string;
  runtime: unknown;
  permissions: string[];
  /** Bare specifiers the plugin may import, mapped to file URLs the host resolved. */
  modules: Record<string, string>;
  cacheEnabled: boolean;
  httpBase: string;
}

interface InvokeMessage {
  type: "invoke";
  id: number;
  kind: InvokeKind;
  handlerId: number;
  name?: string;
  args: unknown[];
}

interface ReplyMessage {
  type: "reply";
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

interface Registration {
  type: "hook" | "route";
  kind: string;
  name: string;
  options: unknown;
  handlerId: number;
}

const invocation = new AsyncLocalStorage<number>();
const handlers = new Map<number, AnyFn>();
const registrations: Registration[] = [];
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let nextHandlerId = 1;
let nextCallId = 1;
let activating = false;
let pluginModule: Record<string, AnyFn | undefined> | null = null;
let ctx: Record<string, unknown> | null = null;

function send(message: unknown): void {
  if (process.connected) process.send?.(message);
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 2000);
}

/** A `ctx` call: the host's broker runs it, in the request that invoked this handler. */
function call(op: string, args: unknown[]): Promise<any> {
  const id = nextCallId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ type: "call", id, op, args, via: invocation.getStore() ?? 0 });
  });
}

/** A namespace the sandbox does not broker yet. Reading it is fine; using it throws. */
function unavailable(name: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then" || typeof property === "symbol") return undefined;
        throw new Error(`ctx.${name}.${String(property)} is not available to sandboxed plugins`);
      },
    },
  );
}

/** Only plain option values cross the boundary. */
function plainOptions(options: unknown): unknown {
  if (!options || typeof options !== "object") return undefined;
  try {
    return JSON.parse(JSON.stringify(options));
  } catch {
    return undefined;
  }
}

function register(type: "hook" | "route", kind: string, name: string, handler: unknown, options: unknown): () => void {
  if (!activating) throw new Error("Sandboxed plugins register hooks and routes while activate() runs");
  if (typeof handler !== "function") throw new Error(`The ${type} handler for "${name}" is not a function`);
  const handlerId = nextHandlerId++;
  handlers.set(handlerId, handler as AnyFn);
  registrations.push({ type, kind, name: String(name), options: plainOptions(options), handlerId });
  return () => {
    handlers.delete(handlerId);
    send({ type: "unsubscribe", handlerId });
  };
}

function buildContext(init: InitMessage): Record<string, unknown> {
  const route = (method: string) => (path: string, handler: unknown, options?: unknown) => {
    register("route", method, path, handler, options);
  };
  const log = (level: string) => (message: unknown, context?: unknown) => {
    void call("log", [level, String(message).slice(0, 2000), plainOptions(context)]).catch(() => undefined);
  };
  const cache = {
    enabled: init.cacheEnabled,
    get: (key: string) => call("cache.get", [key]),
    set: (key: string, value: unknown, ttl?: number) => call("cache.set", [key, value, ttl]),
    delete: (key: string) => call("cache.delete", [key]),
    invalidate: (prefix?: string) => call("cache.invalidate", [prefix]),
    /** Read-through without in-flight deduplication: the value is computed here, stored by the host. */
    async remember(key: string, ttl: number, fn: () => Promise<unknown>) {
      const hit = await call("cache.get", [key]);
      if (hit !== undefined && hit !== null) return hit;
      const value = await fn();
      await call("cache.set", [key, value, ttl]);
      return value;
    },
  };
  const data = {
    list: (collection: string) => call("data.list", [collection]),
    get: (collection: string, id: string) => call("data.get", [collection, id]),
    put: (collection: string, id: string, value: unknown) => call("data.put", [collection, id, value]),
    delete: (collection: string, id: string) => call("data.delete", [collection, id]),
    cas: (collection: string, id: string, expected: string, value: unknown) => call("data.cas", [collection, id, expected, value]),
    clear: () => call("data.clear", []),
    transaction: () => {
      throw new Error("ctx.data.transaction is not available to sandboxed plugins");
    },
  };
  return {
    pluginId: init.pluginId,
    version: init.version,
    runtime: init.runtime,
    permissions: new Set(init.permissions),
    logger: { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") },
    cache,
    data,
    settings: {
      get: (key: string) => call("settings.get", [key]),
      set: (key: string, value: unknown) => call("settings.set", [key, value]),
      delete: (key: string) => call("settings.delete", [key]),
    },
    secrets: {
      get: (key: string) => call("secrets.get", [key]),
      set: (key: string, value: string) => call("secrets.set", [key, value]),
      has: (key: string) => call("secrets.has", [key]),
      delete: (key: string) => call("secrets.delete", [key]),
    },
    hooks: {
      action: (hook: string, handler: unknown, options?: unknown) => register("hook", "action", hook, handler, options),
      gate: (hook: string, handler: unknown, options?: unknown) => register("hook", "gate", hook, handler, options),
      filter: (hook: string, handler: unknown, options?: unknown) => register("hook", "filter", hook, handler, options),
      emit: (hook: string, event: unknown) => call("hooks.emit", [hook, event]),
      apply: (hook: string, value: unknown, context: unknown) => call("hooks.apply", [hook, value, context]),
      check: (hook: string, event: unknown) => call("hooks.check", [hook, event]),
      /** Listener state lives in the host; answer conservatively so callers do the work. */
      has: () => true,
    },
    http: {
      url: (path?: string) => `${init.httpBase}${path ? (path.startsWith("/") ? path : `/${path}`) : ""}`,
      get: route("GET"),
      post: route("POST"),
      put: route("PUT"),
      patch: route("PATCH"),
      delete: route("DELETE"),
    },
    capabilities: unavailable("capabilities"),
    roles: unavailable("roles"),
    users: unavailable("users"),
    diagnostics: unavailable("diagnostics"),
    jobs: unavailable("jobs"),
    mail: unavailable("mail"),
    databases: unavailable("databases"),
    tenancy: unavailable("tenancy"),
    quotas: unavailable("quotas"),
    content: unavailable("content"),
    files: unavailable("files"),
    blocks: unavailable("blocks"),
    i18n: unavailable("i18n"),
    ai: unavailable("ai"),
    captcha: unavailable("captcha"),
    cookies: unavailable("cookies"),
    patterns: unavailable("patterns"),
    visibility: unavailable("visibility"),
    placeholders: unavailable("placeholders"),
    events: unavailable("events"),
    network: undefined,
    outbound: undefined,
  };
}

async function start(init: InitMessage): Promise<void> {
  /** Only the SDK and its own dependencies can be imported by name. */
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const mapped = init.modules[specifier];
      if (mapped) return { url: mapped, shortCircuit: true };
      if (specifier.startsWith("node:") || isBuiltin(specifier)) return nextResolve(specifier, context);
      if (/^(\.{1,2}\/|\/|file:)/.test(specifier)) return nextResolve(specifier, context);
      throw new Error(`"${specifier}" is not available to sandboxed plugins`);
    },
  });
  const loaded = (await import(pathToFileURL(init.entry).href)) as { default?: unknown };
  pluginModule = ((loaded.default ?? loaded) as Record<string, AnyFn | undefined>) ?? null;
  if (!pluginModule || typeof pluginModule.activate !== "function") throw new Error("The plugin has no activate() function");
  ctx = buildContext(init);
  activating = true;
  try {
    await pluginModule.activate(ctx);
  } finally {
    activating = false;
  }
}

async function runInvocation(message: InvokeMessage): Promise<unknown> {
  if (message.kind === "lifecycle") {
    const fn = pluginModule?.[message.name ?? ""];
    if (typeof fn !== "function") return null;
    await fn(ctx);
    return null;
  }
  const handler = handlers.get(message.handlerId);
  if (!handler) throw new Error("This handler is no longer registered");
  if (message.kind === "gate") {
    let reason: string | null = null;
    const payload = message.args[0] && typeof message.args[0] === "object" ? message.args[0] : {};
    const event = { ...(payload as object), cancel: (why: unknown) => { reason = String(why ?? "Cancelled"); } };
    await handler(event, message.args[1]);
    return { cancelled: reason };
  }
  if (message.kind === "filter") return handler(message.args[0], message.args[1], message.args[2]);
  if (message.kind === "action") {
    await handler(message.args[0], message.args[1]);
    return null;
  }
  return handler(message.args[0]);
}

process.on("message", (raw: unknown) => {
  const message = raw as { type?: string };
  if (message.type === "reply") {
    const reply = raw as ReplyMessage;
    const waiter = pending.get(reply.id);
    if (!waiter) return;
    pending.delete(reply.id);
    if (reply.ok) waiter.resolve(reply.value);
    else waiter.reject(new Error(reply.error ?? "The host refused this call"));
    return;
  }
  if (message.type === "init") {
    start(raw as InitMessage).then(
      () => send({ type: "ready", registrations }),
      (error) => send({ type: "failed", error: errorText(error) }),
    );
    return;
  }
  if (message.type === "invoke") {
    const invoke = raw as InvokeMessage;
    invocation
      .run(invoke.id, () => runInvocation(invoke))
      .then(
        (value) => send({ type: "result", id: invoke.id, ok: true, value }),
        (error) => send({ type: "result", id: invoke.id, ok: false, error: errorText(error) }),
      );
  }
});

/** A lost host means nothing is left to answer to. */
process.on("disconnect", () => process.exit(0));
process.on("uncaughtException", (error) => {
  send({ type: "crashed", error: errorText(error) });
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  send({ type: "crashed", error: errorText(error) });
  process.exit(1);
});
