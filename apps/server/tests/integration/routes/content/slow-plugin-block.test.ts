// SPDX-License-Identifier: MIT
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PluginBlockDefinition } from "@justflows/sdk";

/**
 * A plugin block whose `render` takes several seconds (justflows-ce#316):
 * it must not hold up the other previews in a batch or the rest of a page
 * beyond the limit, and administrators must be able to see it.
 */

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";
process.env.JF_PLUGIN_RENDER_LIMIT_MS = "200";

vi.mock("../../../../src/middleware/auth.js", () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

const { pluginBlockAdapter, getRuntimeBlockRegistry } = await import("../../../../src/lib/rendering/runtime-blocks.js");
const { default: router } = await import("../../../../src/routes/content/blocks.js");
const { blockRenderReport, resetBlockRenderStatsForTests } = await import("../../../../src/lib/rendering/plugin-render-guard.js");

const SLOW_MS = 4_000;

function definition(type: string, render: () => string): PluginBlockDefinition {
  return { type, version: 1, title: type, schema: {}, validateProps: () => ({}), render } as unknown as PluginBlockDefinition;
}

pluginBlockAdapter().register(
  definition("acme.slowmap", () => {
    const end = Date.now() + SLOW_MS;
    while (Date.now() < end) {
      /** A plugin stuck on a slow computation. */
    }
    return "<div>map</div>";
  }),
);
pluginBlockAdapter().register(definition("acme.badge", () => "<span>badge</span>"));

let server: Server;
let base = "";
beforeAll(async () => {
  resetBlockRenderStatsForTests();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const app = express();
  app.use(express.json());
  app.use("/api/blocks", router);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("a slow plugin block", () => {
  it("does not hold up the other previews in a batch beyond the limit", async () => {
    const started = Date.now();
    const res = await fetch(`${base}/api/blocks/preview/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ type: "acme.slowmap", props: {} }, { type: "acme.badge", props: {} }, { type: "acme.slowmap", props: {} }, { type: "core.paragraph", props: { text: "Hello" } }] }),
    });
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: Array<{ status: number; body: { html?: string; error?: string } }> };
    expect(results[0]).toMatchObject({ status: 503, body: { error: "This block took too long to draw" } });
    expect(results[1]).toMatchObject({ status: 200, body: { html: "<span>badge</span>" } });
    /** The second copy is skipped at once: the type is paused after the first timeout. */
    expect(results[2]).toMatchObject({ status: 503, body: { error: "This block is paused because it took too long to draw" } });
    expect(results[3]?.status).toBe(200);
    expect(elapsed).toBeLessThan(SLOW_MS / 2);
  });

  it("is left out of a public page, which renders the rest without waiting", () => {
    resetBlockRenderStatsForTests();
    const started = Date.now();
    const html = getRuntimeBlockRegistry().renderDocument({
      blocks: [
        { type: "core.paragraph", props: { text: "Before" } },
        { type: "acme.slowmap", props: {} },
        { type: "acme.badge", props: {} },
      ],
    });
    expect(Date.now() - started).toBeLessThan(SLOW_MS / 2);
    expect(html).toContain("Before");
    expect(html).toContain("<span>badge</span>");
    expect(html).not.toContain("map</div>");
  });

  it("is listed for administrators as stopped and paused", () => {
    const report = blockRenderReport();
    expect(report.limitMs).toBe(200);
    expect(report.types).toEqual([expect.objectContaining({ type: "acme.slowmap", timeouts: 1, pausedUntil: expect.any(String) })]);
  });
});
