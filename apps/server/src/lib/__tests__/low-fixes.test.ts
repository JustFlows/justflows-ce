import express from "express";
import cookieParser from "cookie-parser";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";
process.env.STATE = "INSTALLED";

vi.mock("../db.js", () => ({
  getDb: async () => ({
    query: async () => [],
    run: async () => {},
    close: async () => {},
  }),
  resetDb: () => {},
}));
vi.mock("../plugin-runtime.js", () => ({
  getRuntimeHooks: () => ({ dispatchAction: async () => {}, has: () => false }),
  ensurePluginRuntime: async () => {},
  getPluginLoader: () => null,
}));

const { default: blocksRoutes } = await import("../../routes/blocks.js");
const { csrfProtection } = await import("../../middleware/csrf.js");
const { securityHeaders } = await import("../../middleware/security-headers.js");

let server: any;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  // Same order as createApp(): headers first, so even a 403 from the CSRF
  // middleware carries them.
  app.use(securityHeaders);
  app.use("/api", csrfProtection);
  app.use("/api/blocks", blocksRoutes);
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

describe("L1 — the block registry is not public", () => {
  it("refuses an anonymous caller", async () => {
    const res = await fetch(`${base}/api/blocks`);
    expect(res.status).toBe(401);
    // The plugin inventory must not be in the body either.
    expect(await res.text()).not.toContain("core.paragraph");
  });
});

describe("L5 — a CSRF rejection still carries security headers", () => {
  it("sets them on the 403", async () => {
    const res = await fetch(`${base}/api/blocks`, { method: "POST" });
    expect(res.status).toBe(403);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBeTruthy();
    expect(res.headers.get("x-frame-options")).toBeTruthy();
  });

  it("sets them on a 401 too", async () => {
    const res = await fetch(`${base}/api/blocks`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
