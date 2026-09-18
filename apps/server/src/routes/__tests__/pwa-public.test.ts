// SPDX-License-Identifier: MIT

import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let stored: Record<string, unknown> = {};

vi.mock("../../lib/site-settings.js", () => ({
  getSiteId: async () => "s1",
  getSiteSetting: async () => stored,
  setSiteSetting: async () => {},
}));

const { default: pwaPublicRouter } = await import("../pwa-public.js");

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(pwaPublicRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  stored = {};
});

describe("GET /manifest.webmanifest", () => {
  it("404s when PWA is disabled", async () => {
    expect((await fetch(`${base}/manifest.webmanifest`)).status).toBe(404);
  });

  it("serves the manifest with the correct content type when enabled", async () => {
    stored = { enabled: true, appName: "My Site", icon512Url: "/uploads/icon-512.png" };
    const res = await fetch(`${base}/manifest.webmanifest`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/manifest+json");
    const body = await res.json();
    expect(body.name).toBe("My Site");
    expect(body.scope).toBe("/");
  });
});

describe("GET /sw.js", () => {
  it("serves the retirement worker when disabled", async () => {
    const res = await fetch(`${base}/sw.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain("self.registration.unregister()");
  });

  it("serves the real worker when enabled", async () => {
    stored = { enabled: true, appName: "My Site", icon512Url: "/uploads/icon-512.png" };
    const text = await (await fetch(`${base}/sw.js`)).text();
    expect(text).toContain("staleWhileRevalidate");
    expect(text).not.toContain("self.registration.unregister()");
  });

  it("is always reachable regardless of enabled state (retirement URL guarantee)", async () => {
    expect((await fetch(`${base}/sw.js`)).status).toBe(200);
    stored = { enabled: true, appName: "My Site", icon512Url: "/uploads/icon-512.png" };
    expect((await fetch(`${base}/sw.js`)).status).toBe(200);
  });
});

describe("GET /pwa-offline.html", () => {
  it("404s when disabled", async () => {
    expect((await fetch(`${base}/pwa-offline.html`)).status).toBe(404);
  });

  it("serves the branded offline page when enabled", async () => {
    stored = {
      enabled: true,
      appName: "My Site",
      icon512Url: "/uploads/icon-512.png",
      offline: { title: "No connection", message: "Try again soon." },
    };
    const res = await fetch(`${base}/pwa-offline.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("No connection");
    expect(html).toContain("Try again soon.");
  });
});
