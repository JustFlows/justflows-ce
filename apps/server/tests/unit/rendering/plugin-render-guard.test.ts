// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blockRenderReport, guardedRender, pluginRenderLimitMs, resetBlockRenderStatsForTests, takeRenderOutcome, withRenderTimeLimit } from "../../../src/lib/rendering/plugin-render-guard.js";

/** Time limits for plugin block renders (justflows-ce#316). */

function busy(ms: number): string {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /** Spin, as a slow plugin would. */
  }
  return "<p>late</p>";
}

let clock = 1_000_000;
const ORIGINAL = process.env.JF_PLUGIN_RENDER_LIMIT_MS;
beforeEach(() => {
  clock = 1_000_000;
  process.env.JF_PLUGIN_RENDER_LIMIT_MS = "100";
  resetBlockRenderStatsForTests(() => clock);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.JF_PLUGIN_RENDER_LIMIT_MS;
  else process.env.JF_PLUGIN_RENDER_LIMIT_MS = ORIGINAL;
  resetBlockRenderStatsForTests();
  vi.restoreAllMocks();
});

describe("plugin render time limit", () => {
  it("passes a fast render through untouched", () => {
    expect(guardedRender("acme.fast", () => "<p>hi</p>")).toBe("<p>hi</p>");
    expect(takeRenderOutcome("acme.fast")).toBe("ok");
    expect(blockRenderReport().types).toEqual([]);
  });

  it("stops a render that runs for seconds at the limit", () => {
    resetBlockRenderStatsForTests();
    const started = Date.now();
    expect(guardedRender("acme.slow", () => busy(5_000))).toBe("");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(takeRenderOutcome("acme.slow")).toBe("timeout");
  });

  it("stops an endless loop", () => {
    resetBlockRenderStatsForTests();
    const started = Date.now();
    expect(
      guardedRender("acme.loop", () => {
        for (;;) {
          /** Never returns. */
        }
      }),
    ).toBe("");
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("pauses a type that timed out, then gives it one try after the pause, doubling the pause on another timeout", () => {
    expect(guardedRender("acme.slow", () => busy(2_000))).toBe("");
    const spy = vi.fn(() => "<p>fast now</p>");
    expect(guardedRender("acme.slow", spy)).toBe("");
    expect(spy).not.toHaveBeenCalled();
    expect(takeRenderOutcome("acme.slow")).toBe("paused");
    expect(blockRenderReport().types[0]).toMatchObject({ type: "acme.slow", timeouts: 1, skipped: 1, pausedUntil: new Date(clock + 60_000).toISOString() });

    clock += 60_001;
    expect(guardedRender("acme.slow", () => busy(2_000))).toBe("");
    expect(blockRenderReport().types[0]?.pausedUntil).toBe(new Date(clock + 120_000).toISOString());

    clock += 120_001;
    expect(guardedRender("acme.slow", spy)).toBe("<p>fast now</p>");
    expect(blockRenderReport().types[0]?.pausedUntil).toBeNull();
  });

  it("reports slow renders within the limit without pausing them", () => {
    process.env.JF_PLUGIN_RENDER_LIMIT_MS = "2000";
    resetBlockRenderStatsForTests();
    expect(guardedRender("acme.sluggish", () => busy(300))).toBe("<p>late</p>");
    expect(blockRenderReport().types).toEqual([expect.objectContaining({ type: "acme.sluggish", slow: 1, timeouts: 0, pausedUntil: null })]);
  });

  it("throws a plugin's own error as before", () => {
    expect(() => guardedRender("acme.broken", () => { throw new Error("broken"); })).toThrow("broken");
    expect(takeRenderOutcome("acme.broken")).toBe("error");
  });

  it("keeps the definition's other members when wrapping", () => {
    const definition = { type: "acme.card", version: 3, validateProps: (raw: unknown) => raw, render: (props: { title: string }) => `<h3>${props.title}</h3>` };
    const wrapped = withRenderTimeLimit(definition);
    expect(wrapped.version).toBe(3);
    expect(wrapped.validateProps("x")).toBe("x");
    expect(wrapped.render({ title: "Hi" })).toBe("<h3>Hi</h3>");
  });

  it("reads the limit from the environment within bounds", () => {
    process.env.JF_PLUGIN_RENDER_LIMIT_MS = "5";
    expect(pluginRenderLimitMs()).toBe(50);
    process.env.JF_PLUGIN_RENDER_LIMIT_MS = "nope";
    expect(pluginRenderLimitMs()).toBe(1_000);
    process.env.JF_PLUGIN_RENDER_LIMIT_MS = "999999";
    expect(pluginRenderLimitMs()).toBe(30_000);
  });
});
