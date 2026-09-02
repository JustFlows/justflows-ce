// SPDX-License-Identifier: MIT

import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
let authed = true;

vi.mock("../user-preferences.js", () => ({
  getUserPreferences: async (_userId: string) => Object.fromEntries(store),
  setUserPreference: async (_userId: string, key: string, value: unknown) => {
    store.set(key, value);
  },
}));

vi.mock("../../middleware/auth.js", () => ({
  requireSession: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!authed) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    (req as express.Request & { session?: unknown }).session = {
      userId: "user-1",
      siteId: "site-1",
      role: "administrator",
      email: "admin@example.com",
    };
    next();
  },
}));

const { default: preferencesRoutes } = await import("../../routes/preferences.js");

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/preferences", preferencesRoutes);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(() => r(null))));
beforeEach(() => {
  store.clear();
  authed = true;
});

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(base + "/api/preferences" + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

describe("/api/preferences", () => {
  it("GET returns only allowlisted keys that are stored", async () => {
    store.set("dashboard_welcome", { dismissed: true, collapsed: false });
    store.set("something_else", { x: 1 });
    const r = await req("GET", "/");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      preferences: { dashboard_welcome: { dismissed: true, collapsed: false } },
    });
  });

  it("GET returns an empty object when nothing is stored", async () => {
    const r = await req("GET", "/");
    expect(r.body).toEqual({ preferences: {} });
  });

  it("PUT persists a valid preference and round-trips through GET", async () => {
    const put = await req("PUT", "/dashboard_welcome", { dismissed: false, collapsed: true });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({
      key: "dashboard_welcome",
      value: { dismissed: false, collapsed: true },
    });

    const get = await req("GET", "/");
    expect(get.body).toEqual({
      preferences: { dashboard_welcome: { dismissed: false, collapsed: true } },
    });
  });

  it("PUT rejects an unknown preference key", async () => {
    const r = await req("PUT", "/theme_color", { dismissed: true, collapsed: true });
    expect(r.status).toBe(400);
    expect(store.size).toBe(0);
  });

  it("PUT rejects a malformed body", async () => {
    expect((await req("PUT", "/dashboard_welcome", { dismissed: "yes" })).status).toBe(400);
    expect((await req("PUT", "/dashboard_welcome", { dismissed: true })).status).toBe(400);
    expect(
      (await req("PUT", "/dashboard_welcome", { dismissed: true, collapsed: true, extra: 1 }))
        .status,
    ).toBe(400);
    expect(store.size).toBe(0);
  });

  it("requires a session", async () => {
    authed = false;
    expect((await req("GET", "/")).status).toBe(401);
    expect(
      (await req("PUT", "/dashboard_welcome", { dismissed: true, collapsed: true })).status,
    ).toBe(401);
  });
});
