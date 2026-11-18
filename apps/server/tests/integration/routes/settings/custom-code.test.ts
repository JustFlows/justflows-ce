// SPDX-License-Identifier: MIT

import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ROLE_CAPABILITIES } from "@justflows/sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Custom code is only for people with `code:manage` (justflows-ce#94), which
 * built-in roles other than administrator do not have. Every change is
 * validated before it is stored and audited with a diff.
 */
const state = vi.hoisted(() => ({ role: "administrator", settings: new Map<string, unknown>(), audits: [] as Array<{ action: string; detail?: string }> }));

vi.mock("../../../../src/middleware/auth.js", () => ({
  requireCapability:
    (capability: string) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const held = (ROLE_CAPABILITIES as Record<string, string[]>)[state.role] ?? [];
      if (!held.includes(capability)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      (req as unknown as { session: unknown }).session = { siteId: "site-1", userId: "user-1", role: state.role };
      next();
    },
}));
vi.mock("express-rate-limit", () => ({
  rateLimit: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock("../../../../src/lib/settings/site-settings.js", () => ({
  getSiteSetting: async (siteId: string, key: string) => state.settings.get(`${siteId}:${key}`) ?? null,
  setSiteSetting: async (siteId: string, key: string, value: unknown) => {
    state.settings.set(`${siteId}:${key}`, JSON.parse(JSON.stringify(value)));
  },
}));
vi.mock("../../../../src/lib/security/audit-log.js", () => ({
  auditFromRequest: (_req: unknown, action: string, entry: { detail?: string }) => state.audits.push({ action, detail: entry.detail }),
}));

let server: Server;
let base = "";

beforeAll(async () => {
  const { default: routes } = await import("../../../../src/routes/settings/custom-code.js");
  const app = express();
  app.use(express.json());
  app.use("/api/custom-code", routes);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/custom-code`;
});
afterAll(() => new Promise((resolve) => server.close(() => resolve(null))));
beforeEach(() => {
  state.role = "administrator";
  state.settings.clear();
  state.audits.length = 0;
});

const put = (body: unknown) => fetch(base, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const snippet = { name: "Hello", enabled: true, placement: "head", kind: "inline", code: "window.hello=1;", scope: { type: "site" }, consent: "necessary", environments: [] };

describe("custom code access", () => {
  it.each(["editor", "author", "contributor", "subscriber"])("refuses %s", async (role) => {
    state.role = role;
    expect((await fetch(base)).status).toBe(403);
    expect((await put({ snippets: [snippet] })).status).toBe(403);
    expect((await fetch(`${base}/safe-mode`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(403);
    expect(state.settings.size).toBe(0);
  });

  it("refuses invalid code without storing anything", async () => {
    const res = await put({ snippets: [{ ...snippet, code: "</script><script>alert(1)" }] });
    expect(res.status).toBe(400);
    expect(state.settings.size).toBe(0);
    expect(state.audits).toEqual([]);
  });

  it("stores a valid change, keeps a version, and audits it with a diff", async () => {
    const res = await put({ snippets: [snippet] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, version: 1 });
    expect(state.audits).toEqual([{ action: "custom_code.changed", detail: expect.stringContaining("+ Hello [inline, head, all pages") }]);
    const loaded = (await (await fetch(base)).json()) as { config: { snippets: unknown[] }; versions: Array<{ version: number }> };
    expect(loaded.config.snippets).toHaveLength(1);
    expect(loaded.versions.map((entry) => entry.version)).toEqual([1]);
  });

  it("turns safe mode on and audits it", async () => {
    await put({ snippets: [snippet] });
    const res = await fetch(`${base}/safe-mode`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) });
    expect(await res.json()).toMatchObject({ ok: true, safeMode: true });
    expect(state.audits.at(-1)).toEqual({ action: "custom_code.safe_mode", detail: expect.stringContaining("safe mode on") });
  });
});
