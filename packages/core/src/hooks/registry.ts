// SPDX-License-Identifier: MIT

import { createLogger, type Logger } from "../logging/logger.js";
import { HookAbortError } from "./errors.js";

// ─── Public types ──────────────────────────────────────────────────────────

export type HookSource = "http" | "job" | "cli" | "system";

export interface HookActor {
  readonly userId?: string;
  readonly role?: string;
}

/**
 * Correlation data passed to every handler. Carries identity and provenance —
 * never secrets, database handles or request/response objects.
 */
export interface HookContext {
  readonly siteId?: string;
  readonly requestId?: string;
  readonly source?: HookSource;
  readonly actor?: HookActor;
}

/** Adds cancellation rights to a gate event payload. */
export type Cancellable<T> = T & {
  /** Abort the pending operation. The reason is surfaced to the end user. */
  cancel(reason: string): void;
};

export type ActionHandler<T = unknown> = (
  event: T,
  context: HookContext,
) => void | Promise<void>;

export type GateHandler<T = unknown> = (
  event: Cancellable<T>,
  context: HookContext,
) => void | Promise<void>;

export type FilterHandler<T = unknown, C = unknown> = (
  value: T,
  context: C,
  hookContext: HookContext,
) => T | Promise<T>;

export type Unsubscribe = () => void;

export interface HookRegisterOptions {
  /** Lower runs earlier. Default 100. */
  priority?: number;
  /** Owning plugin. Injected by the runtime — plugins cannot set this. */
  pluginId?: string;
  /** Auto-dispose after the first dispatch. */
  once?: boolean;
  /** Stable label used in diagnostics and the admin hooks screen. */
  id?: string;
}

export interface HooksRegistryOptions {
  logger?: Logger;
  /** Warn when a handler exceeds this duration. `0` disables all timing. */
  slowHandlerMs?: number;
  /** Disable a handler after this many consecutive failures. `0` disables. */
  failureThreshold?: number;
  /** Maximum re-entrant depth for a single hook name. */
  maxDepth?: number;
  /** Freeze action payloads so handlers cannot mutate shared state (dev). */
  freezeEvents?: boolean;
}

export type HookKind = "action" | "filter";

export interface HookInspection {
  readonly hook: string;
  readonly kind: HookKind;
  readonly pluginId: string | null;
  readonly handlerId: string | null;
  readonly priority: number;
  readonly runs: number;
  readonly errors: number;
  readonly totalMs: number;
  readonly disabled: boolean;
}

// ─── Internals ─────────────────────────────────────────────────────────────

const RESOLVED: Promise<void> = Promise.resolve();
const EMPTY_CONTEXT: HookContext = Object.freeze({});
const DEFAULT_PRIORITY = 100;

interface Registration {
  readonly hook: string;
  readonly kind: HookKind;
  readonly handler: (...args: never[]) => unknown;
  readonly priority: number;
  readonly seq: number;
  readonly pluginId: string | undefined;
  readonly id: string | undefined;
  readonly once: boolean;
  removed: boolean;
  disabled: boolean;
  failures: number;
  runs: number;
  errors: number;
  totalMs: number;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

function describe(reg: Registration): string {
  const owner = reg.pluginId ?? "core";
  return reg.id === undefined ? owner : `${owner}#${reg.id}`;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The Justflows hook registry.
 *
 * Three dispatch shapes share one storage model:
 *
 *   - actions — observe, isolated failures, never cancel
 *   - gates   — validate before a write, fail closed, may cancel
 *   - filters — transform a value through an ordered pipeline
 *
 * Dispatch iterates an immutable snapshot of the handler list, so registering
 * during a dispatch cannot corrupt the in-flight run. Handlers are invoked
 * directly and only awaited when they actually return a thenable, so a hook
 * with synchronous handlers costs no microtasks and an unlistened hook costs
 * one map lookup.
 */
export class HooksRegistry {
  private readonly actions = new Map<string, readonly Registration[]>();
  private readonly filters = new Map<string, readonly Registration[]>();
  private readonly counts = new Map<string, number>();
  private readonly depth = new Map<string, number>();

  private readonly logger: Logger;
  private readonly slowHandlerMs: number;
  private readonly failureThreshold: number;
  private readonly maxDepth: number;
  private readonly freezeEvents: boolean;
  private readonly timing: boolean;

  private seq = 0;

  constructor(options: HooksRegistryOptions = {}) {
    this.logger = options.logger ?? createLogger("info");
    this.slowHandlerMs = options.slowHandlerMs ?? 250;
    this.failureThreshold = options.failureThreshold ?? 10;
    this.maxDepth = options.maxDepth ?? 32;
    this.freezeEvents = options.freezeEvents ?? false;
    this.timing = this.slowHandlerMs > 0;
  }

  // ─── Registration ────────────────────────────────────────────────────────

  /** Register an action handler. Returns a dispose function. */
  action<T = unknown>(
    hook: string,
    handler: ActionHandler<T>,
    options: HookRegisterOptions = {},
  ): Unsubscribe {
    return this.register(this.actions, "action", hook, handler as never, options);
  }

  /**
   * Register a gate handler on a `*.before*` hook. Identical storage to an
   * action — the cancellation contract lives at the dispatch site.
   */
  gate<T = unknown>(
    hook: string,
    handler: GateHandler<T>,
    options: HookRegisterOptions = {},
  ): Unsubscribe {
    return this.register(this.actions, "action", hook, handler as never, options);
  }

  /** Register a filter handler. Returns a dispose function. */
  filter<T = unknown, C = unknown>(
    hook: string,
    handler: FilterHandler<T, C>,
    options: HookRegisterOptions = {},
  ): Unsubscribe {
    return this.register(this.filters, "filter", hook, handler as never, options);
  }

  private register(
    store: Map<string, readonly Registration[]>,
    kind: HookKind,
    hook: string,
    handler: (...args: never[]) => unknown,
    options: HookRegisterOptions,
  ): Unsubscribe {
    if (typeof handler !== "function") {
      throw new TypeError(`Hook handler for "${hook}" must be a function`);
    }

    const reg: Registration = {
      hook,
      kind,
      handler,
      priority: options.priority ?? DEFAULT_PRIORITY,
      seq: this.seq++,
      pluginId: options.pluginId,
      id: options.id,
      once: options.once ?? false,
      removed: false,
      disabled: false,
      failures: 0,
      runs: 0,
      errors: 0,
      totalMs: 0,
    };

    store.set(hook, insertOrdered(store.get(hook), reg));

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.remove(store, reg);
    };
  }

  private remove(store: Map<string, readonly Registration[]>, reg: Registration): void {
    if (reg.removed) return;
    // Tombstone first: an in-flight dispatch iterating the old snapshot checks
    // this flag and skips a handler that was disposed mid-run.
    reg.removed = true;

    const list = store.get(reg.hook);
    if (list === undefined) return;
    const next = list.filter((entry) => entry !== reg);
    if (next.length === 0) store.delete(reg.hook);
    else store.set(reg.hook, next);
  }

  // ─── Action dispatch ─────────────────────────────────────────────────────

  /**
   * Dispatch an action. Never rejects — handler failures are logged with
   * attribution and the remaining handlers still run.
   */
  dispatchAction<T = unknown>(
    hook: string,
    event: T,
    context: HookContext = EMPTY_CONTEXT,
  ): Promise<void> {
    this.counts.set(hook, (this.counts.get(hook) ?? 0) + 1);

    const list = this.actions.get(hook);
    if (list === undefined || list.length === 0) return RESOLVED;
    if (!this.enter(hook)) return RESOLVED;

    const payload = this.freezeEvents ? freezeEvent(event) : event;

    let pending: Promise<void> | undefined;
    try {
      pending = this.runActions(hook, list, payload, context, 0);
    } finally {
      if (pending === undefined) this.exit(hook);
    }
    if (pending === undefined) return RESOLVED;
    return pending.finally(() => this.exit(hook));
  }

  /**
   * Dispatch an action on a path that cannot await (template rendering).
   * Handlers returning a promise are reported and their result is discarded.
   */
  dispatchActionSync<T = unknown>(
    hook: string,
    event: T,
    context: HookContext = EMPTY_CONTEXT,
  ): void {
    this.counts.set(hook, (this.counts.get(hook) ?? 0) + 1);

    const list = this.actions.get(hook);
    if (list === undefined || list.length === 0) return;
    if (!this.enter(hook)) return;

    const payload = this.freezeEvents ? freezeEvent(event) : event;

    try {
      for (let i = 0; i < list.length; i++) {
        const reg = list[i];
        if (reg === undefined || reg.removed || reg.disabled) continue;
        if (reg.once) this.remove(this.actions, reg);

        const started = this.timing ? performance.now() : 0;
        try {
          const result = (reg.handler as ActionHandler<T>)(payload, context);
          if (isThenable(result)) {
            this.reportAsyncOnSyncHook(reg, hook);
            void Promise.resolve(result).catch((err: unknown) => {
              this.recordFailure(reg, err);
            });
            continue;
          }
          this.recordSuccess(reg, started);
        } catch (err) {
          this.recordFailure(reg, err);
        }
      }
    } finally {
      this.exit(hook);
    }
  }

  /**
   * Run the action chain. Returns `undefined` when every handler completed
   * synchronously — the caller then avoids allocating a promise at all.
   */
  private runActions<T>(
    hook: string,
    list: readonly Registration[],
    event: T,
    context: HookContext,
    start: number,
  ): Promise<void> | undefined {
    for (let i = start; i < list.length; i++) {
      const reg = list[i];
      if (reg === undefined || reg.removed || reg.disabled) continue;
      if (reg.once) this.remove(this.actions, reg);

      const started = this.timing ? performance.now() : 0;
      let result: unknown;
      try {
        result = (reg.handler as ActionHandler<T>)(event, context);
      } catch (err) {
        this.recordFailure(reg, err);
        continue;
      }

      if (isThenable(result)) {
        const next = i + 1;
        return Promise.resolve(result).then(
          () => {
            this.recordSuccess(reg, started);
            return this.runActions(hook, list, event, context, next) ?? RESOLVED;
          },
          (err: unknown) => {
            this.recordFailure(reg, err);
            return this.runActions(hook, list, event, context, next) ?? RESOLVED;
          },
        );
      }

      this.recordSuccess(reg, started);
    }
    return undefined;
  }

  // ─── Gate dispatch ───────────────────────────────────────────────────────

  /**
   * Dispatch a cancellable pre-operation hook.
   *
   * Gates fail closed: a handler that calls `cancel(reason)` **or throws**
   * aborts the operation with a {@link HookAbortError} naming the extension.
   * Call this before the operation commits, never after.
   */
  async dispatchGate<T extends object>(
    hook: string,
    event: T,
    context: HookContext = EMPTY_CONTEXT,
  ): Promise<void> {
    this.counts.set(hook, (this.counts.get(hook) ?? 0) + 1);

    const list = this.actions.get(hook);
    if (list === undefined || list.length === 0) return;
    if (!this.enter(hook)) {
      throw new HookAbortError(hook, `Hook "${hook}" exceeded the maximum re-entrant depth`);
    }

    try {
      for (let i = 0; i < list.length; i++) {
        const reg = list[i];
        if (reg === undefined || reg.removed || reg.disabled) continue;
        if (reg.once) this.remove(this.actions, reg);

        let cancelled: string | undefined;
        const payload = Object.assign(Object.create(Object.getPrototypeOf(event) as object), event, {
          cancel: (reason: string) => {
            cancelled = reason || `Cancelled by ${describe(reg)}`;
          },
        }) as Cancellable<T>;

        const started = this.timing ? performance.now() : 0;
        try {
          await (reg.handler as GateHandler<T>)(payload, context);
          this.recordSuccess(reg, started);
        } catch (err) {
          if (err instanceof HookAbortError) throw err;
          this.recordFailure(reg, err);
          throw new HookAbortError(
            hook,
            `Operation blocked by ${describe(reg)}: ${toMessage(err)}`,
            reg.pluginId ?? null,
            err,
          );
        }

        if (cancelled !== undefined) {
          this.logger.info("Gate hook cancelled operation", {
            hook,
            pluginId: reg.pluginId ?? "core",
            reason: cancelled,
          });
          throw new HookAbortError(hook, cancelled, reg.pluginId ?? null);
        }
      }
    } finally {
      this.exit(hook);
    }
  }

  // ─── Filter dispatch ─────────────────────────────────────────────────────

  /** Pass a value through the filter pipeline. Never rejects. */
  applyFilter<T = unknown, C = unknown>(
    hook: string,
    value: T,
    context: C,
    hookContext: HookContext = EMPTY_CONTEXT,
  ): Promise<T> {
    const list = this.filters.get(hook);
    if (list === undefined || list.length === 0) return Promise.resolve(value);
    if (!this.enter(hook)) return Promise.resolve(value);

    let settled = true;
    try {
      const result = this.runFilters(hook, list, value, context, hookContext, 0, true);
      if (isThenable(result)) {
        settled = false;
        return Promise.resolve(result).finally(() => this.exit(hook));
      }
      return Promise.resolve(result);
    } finally {
      if (settled) this.exit(hook);
    }
  }

  /**
   * Synchronous filter pipeline for render paths that cannot await.
   * Handlers returning a promise are reported and skipped — the last good
   * value is kept rather than replaced by a pending promise.
   */
  applyFilterSync<T = unknown, C = unknown>(
    hook: string,
    value: T,
    context: C,
    hookContext: HookContext = EMPTY_CONTEXT,
  ): T {
    const list = this.filters.get(hook);
    if (list === undefined || list.length === 0) return value;
    if (!this.enter(hook)) return value;

    try {
      return this.runFilters(hook, list, value, context, hookContext, 0, false) as T;
    } finally {
      this.exit(hook);
    }
  }

  private runFilters<T>(
    hook: string,
    list: readonly Registration[],
    value: T,
    context: unknown,
    hookContext: HookContext,
    start: number,
    allowAsync: boolean,
  ): T | Promise<T> {
    let current = value;

    for (let i = start; i < list.length; i++) {
      const reg = list[i];
      if (reg === undefined || reg.removed || reg.disabled) continue;
      if (reg.once) this.remove(this.filters, reg);

      const started = this.timing ? performance.now() : 0;
      let result: unknown;
      try {
        result = (reg.handler as FilterHandler<T, unknown>)(current, context, hookContext);
      } catch (err) {
        this.recordFailure(reg, err);
        continue;
      }

      if (isThenable(result)) {
        if (!allowAsync) {
          this.reportAsyncOnSyncHook(reg, hook);
          void Promise.resolve(result).catch(() => undefined);
          continue;
        }
        const next = i + 1;
        const carried = current;
        return Promise.resolve(result).then(
          (resolved: unknown) => {
            this.recordSuccess(reg, started);
            const accepted = this.acceptFilterValue(reg, hook, carried, resolved);
            return this.runFilters(hook, list, accepted, context, hookContext, next, true);
          },
          (err: unknown) => {
            this.recordFailure(reg, err);
            return this.runFilters(hook, list, carried, context, hookContext, next, true);
          },
        );
      }

      this.recordSuccess(reg, started);
      current = this.acceptFilterValue(reg, hook, current, result);
    }

    return current;
  }

  /**
   * Guard against the single most common filter bug: a handler that forgets to
   * return. `undefined` from a filter over a defined value keeps the previous
   * value instead of poisoning the rest of the pipeline.
   */
  private acceptFilterValue<T>(
    reg: Registration,
    hook: string,
    previous: T,
    next: unknown,
  ): T {
    if (next === undefined && previous !== undefined) {
      this.logger.warn("Filter handler returned undefined — previous value kept", {
        hook,
        pluginId: reg.pluginId ?? "core",
        handlerId: reg.id ?? null,
      });
      return previous;
    }
    return next as T;
  }

  // ─── Bookkeeping ─────────────────────────────────────────────────────────

  private recordSuccess(reg: Registration, started: number): void {
    reg.runs++;
    reg.failures = 0;
    if (!this.timing) return;

    const elapsed = performance.now() - started;
    reg.totalMs += elapsed;
    if (elapsed >= this.slowHandlerMs) {
      this.logger.warn("Slow hook handler", {
        hook: reg.hook,
        pluginId: reg.pluginId ?? "core",
        handlerId: reg.id ?? null,
        durationMs: Math.round(elapsed),
      });
    }
  }

  private recordFailure(reg: Registration, err: unknown): void {
    reg.runs++;
    reg.errors++;
    reg.failures++;

    this.logger.error(`${reg.kind === "filter" ? "Filter" : "Action"} hook handler failed`, {
      hook: reg.hook,
      pluginId: reg.pluginId ?? "core",
      handlerId: reg.id ?? null,
      error: toMessage(err),
    });

    if (this.failureThreshold > 0 && reg.failures >= this.failureThreshold && !reg.disabled) {
      reg.disabled = true;
      this.logger.error("Hook handler disabled after repeated failures", {
        hook: reg.hook,
        pluginId: reg.pluginId ?? "core",
        handlerId: reg.id ?? null,
        consecutiveFailures: reg.failures,
      });
    }
  }

  private reportAsyncOnSyncHook(reg: Registration, hook: string): void {
    this.logger.error("Async handler registered on a synchronous hook — result discarded", {
      hook,
      pluginId: reg.pluginId ?? "core",
      handlerId: reg.id ?? null,
    });
  }

  private enter(hook: string): boolean {
    const current = this.depth.get(hook) ?? 0;
    if (current >= this.maxDepth) {
      this.logger.error("Hook recursion limit reached — dispatch refused", {
        hook,
        maxDepth: this.maxDepth,
      });
      return false;
    }
    this.depth.set(hook, current + 1);
    return true;
  }

  private exit(hook: string): void {
    const current = this.depth.get(hook) ?? 0;
    if (current <= 1) this.depth.delete(hook);
    else this.depth.set(hook, current - 1);
  }

  // ─── Introspection and lifecycle ─────────────────────────────────────────

  /** True when at least one live handler is registered for the hook. */
  has(hook: string): boolean {
    return this.count(hook) > 0;
  }

  /** Number of live handlers registered for the hook (actions + filters). */
  count(hook: string): number {
    const enabled = (list: readonly Registration[] | undefined): number =>
      list === undefined ? 0 : list.reduce((n, r) => (r.removed || r.disabled ? n : n + 1), 0);
    return enabled(this.actions.get(hook)) + enabled(this.filters.get(hook));
  }

  /** How many times this action or gate has been dispatched in this process. */
  didAction(hook: string): number {
    return this.counts.get(hook) ?? 0;
  }

  /** Per-handler diagnostics backing the admin hooks screen. */
  inspect(hook?: string): HookInspection[] {
    const out: HookInspection[] = [];
    const collect = (store: Map<string, readonly Registration[]>): void => {
      for (const [name, list] of store) {
        if (hook !== undefined && name !== hook) continue;
        for (const reg of list) {
          if (reg.removed) continue;
          out.push({
            hook: name,
            kind: reg.kind,
            pluginId: reg.pluginId ?? null,
            handlerId: reg.id ?? null,
            priority: reg.priority,
            runs: reg.runs,
            errors: reg.errors,
            totalMs: Math.round(reg.totalMs * 1000) / 1000,
            disabled: reg.disabled,
          });
        }
      }
    };
    collect(this.actions);
    collect(this.filters);
    return out.sort((a, b) => a.hook.localeCompare(b.hook) || a.priority - b.priority);
  }

  /**
   * Remove every handler owned by a plugin. Called on deactivation so a plugin
   * cannot leak handlers across an activate/deactivate cycle, whether or not it
   * kept its dispose functions.
   */
  removePlugin(pluginId: string): number {
    let removed = 0;
    for (const store of [this.actions, this.filters]) {
      for (const [name, list] of store) {
        const keep = list.filter((reg) => {
          if (reg.pluginId !== pluginId) return true;
          reg.removed = true;
          removed++;
          return false;
        });
        if (keep.length === list.length) continue;
        if (keep.length === 0) store.delete(name);
        else store.set(name, keep);
      }
    }
    return removed;
  }

  /** @deprecated Use {@link removePlugin}. */
  deactivatePlugin(pluginId: string): void {
    this.removePlugin(pluginId);
  }

  /** Drop every registration and counter. Intended for tests. */
  clear(): void {
    this.actions.clear();
    this.filters.clear();
    this.counts.clear();
    this.depth.clear();
  }
}

/**
 * Copy-on-write ordered insert. `seq` increases monotonically, so appending
 * after the last entry with `priority <= reg.priority` yields a stable sort by
 * (priority, registration order) without ever calling `Array.sort`.
 */
function insertOrdered(
  list: readonly Registration[] | undefined,
  reg: Registration,
): readonly Registration[] {
  if (list === undefined || list.length === 0) return Object.freeze([reg]);

  const last = list[list.length - 1];
  if (last !== undefined && last.priority <= reg.priority) {
    return Object.freeze([...list, reg]);
  }

  let index = list.length;
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (entry !== undefined && entry.priority > reg.priority) {
      index = i;
      break;
    }
  }
  const next = list.slice();
  next.splice(index, 0, reg);
  return Object.freeze(next);
}

function freezeEvent<T>(event: T): T {
  if (event !== null && typeof event === "object" && !Object.isFrozen(event)) {
    return Object.freeze(event);
  }
  return event;
}
