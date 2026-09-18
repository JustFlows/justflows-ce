// SPDX-License-Identifier: MIT

import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PERMALINK_SETTINGS as settings } from "../../../../src/lib/navigation/permalinks.js";
let role: string | null = "administrator";
const save = vi.fn(async (_siteId: string, _settings: unknown) => 2);
vi.mock("../../../../src/lib/auth/auth-session.js", () => ({
  resolveSession: async () => (role ? { siteId: "s1", userId: "u1", role } : null),
}));
vi.mock("../../../../src/lib/auth/session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/lib/auth/session.js")>()),
  syncCsrfCookie: vi.fn(),
}));
vi.mock("../../../../src/lib/navigation/permalinks-db.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/lib/navigation/permalinks-db.js")>()),
  getPermalinkState: async () => ({ settings, redirects: {} }),
  savePermalinks: (siteId: string, value: unknown) => save(siteId, value),
}));
vi.mock("../../../../src/lib/content/content-types-db.js", () => ({
  listContentTypes: async () => [{ slug: "product", label: "Products" }],
}));
vi.mock("../../../../src/lib/database/db.js", () => ({ getDb: async () => ({ query: async () => [] }) }));
vi.mock("../../../../src/lib/security/audit-log.js", () => ({ auditFromRequest: vi.fn() }));
const { default: settingsRouter } = await import("../../../../src/routes/settings/settings.js");
let server: Server;
let endpoint: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/settings", settingsRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/settings/permalinks`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  role = "administrator";
  save.mockClear();
});
const put = (body: unknown) =>
  fetch(endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
describe("permalink settings authorization and validation", () => {
  it.each([null, "subscriber", "editor"])("rejects reads and writes for %s", async (value) => {
    role = value;
    expect((await fetch(endpoint)).status).toBe(value ? 403 : 401);
    expect((await put(settings)).status).toBe(value ? 403 : 401);
    expect(save).not.toHaveBeenCalled();
  });
  it("returns settings and accepts administrator changes", async () => {
    const config = await (await fetch(endpoint)).json();
    expect(config.settings).toEqual(settings);
    expect(config.types[0].slug).toBe("product");
    expect((await put(settings)).status).toBe(200);
    expect(save).toHaveBeenCalledWith("s1", settings);
  });
  it("rejects invalid tokens and reserved bases before saving", async () => {
    expect((await put({ ...settings, structure: "/%bad%/%id%" })).status).toBe(400);
    expect((await put({ ...settings, categoryBase: "api" })).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
});
