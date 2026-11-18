// SPDX-License-Identifier: MIT

import vm from "node:vm";

/**
 * Time limits for plugin block renders (justflows-ce#316).
 *
 * A plugin block's `render` is synchronous and runs on the server for public
 * pages and builder previews. A slow or looping one used to hold the worker
 * for as long as it ran. Every plugin render now runs under a time limit:
 *
 * - The call is made from a `vm` script with `timeout`, which stops the
 *   running JavaScript when the limit passes, even inside the plugin's own
 *   functions or an endless loop. That costs about 30 µs per render.
 * - A block type that runs out of time is paused: its renders are skipped
 *   at once for a minute, then it gets one try; each further timeout doubles
 *   the pause, up to 15 minutes. A render within the limit closes it again.
 * - Renders slower than {@link SLOW_RENDER_MS} are counted, so administrators
 *   can see slow block types under Health before they hit the limit.
 *
 * A skipped render returns an empty string, which is what a public page
 * shows. Builder previews ask {@link takeRenderOutcome} what happened and
 * show a recoverable block-level error instead.
 *
 * Stopping a render part-way can leave that plugin's own module state
 * half-updated; the pause keeps it from being hit again straight away.
 */

/** Renders slower than this are reported as slow. */
export const SLOW_RENDER_MS = 250;
const DEFAULT_LIMIT_MS = 1_000;
const MIN_LIMIT_MS = 50;
const MAX_LIMIT_MS = 30_000;
const FIRST_PAUSE_MS = 60_000;
const MAX_PAUSE_MS = 15 * 60_000;
/** Block types tracked at once; more are folded away oldest first. */
const MAX_TRACKED_TYPES = 500;

export type RenderOutcome = "ok" | "timeout" | "paused" | "error";

interface TypeStats {
  renders: number;
  slow: number;
  timeouts: number;
  skipped: number;
  totalMs: number;
  maxMs: number;
  pausedUntil: number;
  pauseMs: number;
  lastSlowAt: number | null;
}

export interface BlockRenderTypeReport {
  type: string;
  renders: number;
  slow: number;
  timeouts: number;
  skipped: number;
  averageMs: number;
  maxMs: number;
  pausedUntil: string | null;
  lastSlowAt: string | null;
}

export interface BlockRenderReport {
  limitMs: number;
  slowMs: number;
  types: BlockRenderTypeReport[];
}

const stats = new Map<string, TypeStats>();
let lastOutcome: { type: string; outcome: RenderOutcome } | null = null;
let now: () => number = () => Date.now();

const context = vm.createContext(Object.create(null) as Record<string, unknown>);
const script = new vm.Script("__jfRender()", { filename: "plugin-block-render" });

/** The limit for one render, from `JF_PLUGIN_RENDER_LIMIT_MS` (50–30,000 ms, default 1,000). */
export function pluginRenderLimitMs(): number {
  const raw = Number(process.env.JF_PLUGIN_RENDER_LIMIT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_LIMIT_MS;
  return Math.min(MAX_LIMIT_MS, Math.max(MIN_LIMIT_MS, Math.round(raw)));
}

function statsFor(type: string): TypeStats {
  let entry = stats.get(type);
  if (!entry) {
    if (stats.size >= MAX_TRACKED_TYPES) {
      const oldest = stats.keys().next().value;
      if (oldest !== undefined) stats.delete(oldest);
    }
    entry = { renders: 0, slow: 0, timeouts: 0, skipped: 0, totalMs: 0, maxMs: 0, pausedUntil: 0, pauseMs: 0, lastSlowAt: null };
    stats.set(type, entry);
  }
  return entry;
}

function isTimeout(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: unknown }).code === "ERR_SCRIPT_EXECUTION_TIMEOUT");
}

/**
 * Run one render of `type` under the time limit. Returns the HTML, or an
 * empty string when the type is paused or the render ran out of time. Other
 * errors from the render are thrown, as before.
 */
export function guardedRender(type: string, render: () => string): string {
  const entry = statsFor(type);
  const started = now();
  if (entry.pausedUntil > started) {
    entry.skipped++;
    lastOutcome = { type, outcome: "paused" };
    return "";
  }
  context.__jfRender = render;
  try {
    const html = script.runInContext(context, { timeout: pluginRenderLimitMs() }) as unknown;
    const elapsed = now() - started;
    entry.renders++;
    entry.totalMs += elapsed;
    entry.maxMs = Math.max(entry.maxMs, elapsed);
    if (elapsed >= SLOW_RENDER_MS) {
      entry.slow++;
      entry.lastSlowAt = now();
    }
    entry.pauseMs = 0;
    entry.pausedUntil = 0;
    lastOutcome = { type, outcome: "ok" };
    return typeof html === "string" ? html : String(html ?? "");
  } catch (err) {
    if (!isTimeout(err)) {
      lastOutcome = { type, outcome: "error" };
      throw err;
    }
    const elapsed = now() - started;
    entry.renders++;
    entry.timeouts++;
    entry.slow++;
    entry.totalMs += elapsed;
    entry.maxMs = Math.max(entry.maxMs, elapsed);
    entry.lastSlowAt = now();
    entry.pauseMs = entry.pauseMs ? Math.min(MAX_PAUSE_MS, entry.pauseMs * 2) : FIRST_PAUSE_MS;
    entry.pausedUntil = now() + entry.pauseMs;
    lastOutcome = { type, outcome: "timeout" };
    console.error(`[justflows] block ${JSON.stringify(type)} took longer than ${pluginRenderLimitMs()} ms to render; paused for ${Math.round(entry.pauseMs / 1000)} s`);
    return "";
  } finally {
    context.__jfRender = undefined;
  }
}

/**
 * What the last guarded render of `type` did, read once. Renders are
 * synchronous, so a caller reads it straight after its own render.
 */
export function takeRenderOutcome(type: string): RenderOutcome | null {
  const outcome = lastOutcome && lastOutcome.type === type ? lastOutcome.outcome : null;
  lastOutcome = null;
  return outcome;
}

/** Slow and paused block types, slowest first, for Health and diagnostics. */
export function blockRenderReport(): BlockRenderReport {
  const at = now();
  const types = [...stats.entries()]
    .filter(([, entry]) => entry.slow > 0 || entry.skipped > 0)
    .map(([type, entry]) => ({
      type,
      renders: entry.renders,
      slow: entry.slow,
      timeouts: entry.timeouts,
      skipped: entry.skipped,
      averageMs: entry.renders ? Math.round((entry.totalMs / entry.renders) * 10) / 10 : 0,
      maxMs: Math.round(entry.maxMs * 10) / 10,
      pausedUntil: entry.pausedUntil > at ? new Date(entry.pausedUntil).toISOString() : null,
      lastSlowAt: entry.lastSlowAt ? new Date(entry.lastSlowAt).toISOString() : null,
    }))
    .sort((a, b) => b.timeouts - a.timeouts || b.maxMs - a.maxMs);
  return { limitMs: pluginRenderLimitMs(), slowMs: SLOW_RENDER_MS, types };
}

/** Wrap a plugin block definition so every render goes through {@link guardedRender}. */
export function withRenderTimeLimit<T extends { type: string; render: (...args: never[]) => string }>(definition: T): T {
  const render = definition.render;
  const guarded = {
    ...definition,
    render: (...args: Parameters<T["render"]>) => guardedRender(definition.type, () => render.apply(definition, args)),
  };
  return Object.setPrototypeOf(guarded, Object.getPrototypeOf(definition)) as T;
}

/** Test hooks: reset counters and control the clock. */
export function resetBlockRenderStatsForTests(clock?: () => number): void {
  stats.clear();
  lastOutcome = null;
  now = clock ?? (() => Date.now());
}
