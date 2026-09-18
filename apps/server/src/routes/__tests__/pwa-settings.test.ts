// SPDX-License-Identifier: MIT

import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let role: string | null = "administrator";
let stored: Record<string, unknown> = {};
const setSiteSetting = vi.fn(async (_siteId: string, _key: string, value: unknown) => {
  stored = value as Record<string, unknown>;
});

vi.mock("../../lib/auth-session.js", () => ({
  resolveSession: async () =>
    role ? { siteId: "s1", userId: "u1", role, email: "a@example.com" } : null,
}));
vi.mock("../../lib/session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/session.js")>()),
  syncCsrfCookie: vi.fn(),
}));
vi.mock("../../lib/db.js", () => ({ getDb: async () => ({ query: async () => [] }) }));
vi.mock("../../lib/audit-log.js", () => ({ auditFromRequest: vi.fn() }));
vi.mock("../../lib/site-settings.js", () => ({
  getSiteId: async () => "s1",
  getSiteSetting: async () => stored,
  setSiteSetting: (siteId: string, key: string, value: unknown) => setSiteSetting(siteId, key, value),
}));

const { default: settingsRouter } = await import("../settings.js");

let server: Server;
let endpoint: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/settings", settingsRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/settings/pwa`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  role = "administrator";
  stored = {};
  setSiteSetting.mockClear();
});

const put = (body: unknown) =>
  fetch(endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("PWA settings authorization", () => {
  it.each([null, "subscriber", "editor"])("rejects reads and writes for %s", async (value) => {
    role = value;
    expect((await fetch(endpoint)).status).toBe(value ? 403 : 401);
    expect((await put({ appName: "Site" })).status).toBe(value ? 403 : 401);
    expect(setSiteSetting).not.toHaveBeenCalled();
  });
});

describe("PWA settings read/write", () => {
  it("returns defaults and diagnostics for an administrator", async () => {
    const body = await (await fetch(endpoint)).json();
    expect(body.enabled).toBe(false);
    expect(body.diagnostics).toHaveProperty("manifestUrl", "/manifest.webmanifest");
    expect(body.diagnostics).toHaveProperty("serviceWorkerUrl", "/sw.js");
  });

  it("saves a valid partial update and bumps the cache version", async () => {
    const res = await put({ appName: "My Site", themeColor: "#123456" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.appName).toBe("My Site");
    expect(body.themeColor).toBe("#123456");
    expect(body.cacheVersion).toBe(2);
    expect(setSiteSetting).toHaveBeenCalledTimes(1);
  });

  it("round-trips a full installUi object exactly as the admin UI sends it, including showLogo:false", async () => {
    const res = await put({
      installUi: {
        enabled: true,
        label: "install Justflows",
        description: "Install the app",
        showLogo: false,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.installUi).toEqual({
      enabled: true,
      label: "install Justflows",
      description: "Install the app",
      showLogo: false,
    });
    // And what actually got persisted (what a later GET / render would read back).
    expect(stored.installUi).toEqual(body.installUi);
  });

  it("rejects enabling without an app name and a 512x512 icon", async () => {
    const res = await put({ enabled: true });
    expect(res.status).toBe(400);
    expect(setSiteSetting).not.toHaveBeenCalled();
  });

  it("allows enabling once the requirements are already met", async () => {
    stored = { appName: "My Site", icon512Url: "/uploads/icon-512.png", icon192Url: "/uploads/icon-192.png" };
    const res = await put({ enabled: true });
    expect(res.status).toBe(200);
    expect((await res.json()).enabled).toBe(true);
  });

  it("rejects a start URL under /admin", async () => {
    const res = await put({ startUrl: "/admin/settings" });
    expect(res.status).toBe(400);
    expect(setSiteSetting).not.toHaveBeenCalled();
  });

  it("rejects a shortcut pointing at a private destination", async () => {
    const res = await put({ shortcuts: [{ name: "Admin", url: "/api/content" }] });
    expect(res.status).toBe(400);
    expect(setSiteSetting).not.toHaveBeenCalled();
  });

  it("rejects a malformed body at the schema layer", async () => {
    const res = await put({ display: "popup-window" });
    expect(res.status).toBe(400);
    expect(setSiteSetting).not.toHaveBeenCalled();
  });

  it("caps shortcuts at 4 entries", async () => {
    const shortcuts = Array.from({ length: 5 }, (_, i) => ({ name: `S${i}`, url: `/s${i}` }));
    const res = await put({ shortcuts });
    expect(res.status).toBe(400);
  });
});
