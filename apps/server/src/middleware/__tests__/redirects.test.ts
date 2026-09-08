// SPDX-License-Identifier: MIT
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RedirectRule } from "../../lib/redirects.js";
let rules: RedirectRule[] = [];
const log = vi.fn(async () => {});
vi.mock("../../lib/site-settings.js", () => ({ getSiteId: async () => "site" }));
vi.mock("../../lib/permalinks-db.js", () => ({
  reservedPermalinkPath: async (path: string) => /^\/(api|admin|control-room)(\/|$)/.test(path),
}));
vi.mock("../../lib/redirects-db.js", () => ({
  runtimeRedirects: async () => ({ rules, canonicalize: (path: string) => path }),
  recordNotFound: (...args: unknown[]) => log(...args),
}));
const { managedRedirects } = await import("../redirects.js");
let server: Server, endpoint: string;
beforeAll(async () => {
  const app = express();
  app.get("/plugin-owned", (_req, res) => res.send("plugin"));
  app.use(managedRedirects);
  app.get("/live", (_req, res) => res.send("live content"));
  app.use((_req, res) => res.status(404).send("not found"));
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  rules = [];
  log.mockClear();
});
const rule = (source: string, target: string): RedirectRule => ({
  id: source,
  source,
  target,
  kind: "exact",
  targetType: "internal",
  status: 301,
  enabled: true,
});
describe("public redirect middleware", () => {
  it("overrides public content, preserves plugin/platform routes and skips preview and POST", async () => {
    rules = [
      rule("/live", "/new"),
      rule("/plugin-owned", "/new"),
      rule("/admin", "/new"),
      rule("/control-room", "/new"),
    ];
    const result = await fetch(endpoint + "/live?utm_source=mail", { redirect: "manual" });
    expect(result.status).toBe(301);
    expect(result.headers.get("location")).toBe("/new");
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await (await fetch(endpoint + "/plugin-owned")).text()).toBe("plugin");
    for (const path of ["/admin", "/control-room", "/live?preview=1"])
      expect((await fetch(endpoint + path, { redirect: "manual" })).status).not.toBe(301);
    expect((await fetch(endpoint + "/live", { method: "POST", redirect: "manual" })).status).toBe(
      404,
    );
    expect((await fetch(endpoint + "/live", { method: "HEAD", redirect: "manual" })).status).toBe(
      301,
    );
  });
  it("logs only finished public GET 404s, without query strings", async () => {
    await fetch(endpoint + "/missing?secret=value", {
      headers: { referer: "https://example.test/source" },
    });
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith("site", "/missing", "https://example.test/source"),
    );
    log.mockClear();
    await fetch(endpoint + "/api/missing");
    await fetch(endpoint + "/live");
    await fetch(endpoint + "/head", { method: "HEAD" });
    expect(log).not.toHaveBeenCalled();
  });
  it("falls through when a later content change creates a cycle", async () => {
    rules = [rule("/live", "/old"), rule("/old", "/live")];
    expect(await (await fetch(endpoint + "/live", { redirect: "manual" })).text()).toBe(
      "live content",
    );
  });
});
