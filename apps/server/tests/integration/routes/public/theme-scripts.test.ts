// SPDX-License-Identifier: MIT
import express from "express";
import { rateLimit } from "express-rate-limit";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const themeDir = vi.hoisted(() => {
  const fs = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const p = require("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(p.join(os.tmpdir(), "jf-theme-assets-route-"));
  fs.mkdirSync(p.join(dir, "assets"));
  fs.writeFileSync(p.join(dir, "assets", "lightbox.js"), "window.lightbox = 1;");
  fs.writeFileSync(p.join(dir, "assets", "private.js"), "window.secret = 1;");
  fs.writeFileSync(p.join(dir, "justflows-theme.json"), JSON.stringify({ assets: { blocks: { "core.gallery": { scripts: ["assets/lightbox.js"] } } } }));
  return dir;
});
const mocked = vi.hoisted(() => ({ siteId: "site-a" as string | null, active: { theme_id: "justflows.voyage", manifest: {} } as { theme_id: string; manifest: Record<string, unknown> } | null, load: vi.fn(() => 'window.voyage = true;') }));
vi.mock("../../../../src/lib/themes/themes-db.js", () => ({
  ensureThemesTable: async () => {}, getSiteId: async () => mocked.siteId,
  getActiveTheme: async () => mocked.active, themeInstalledPath: () => null,
}));
vi.mock("../../../../src/lib/themes/theme-files.js", async original => ({
  ...await original<typeof import("../../../../src/lib/themes/theme-files.js")>(), loadThemeScripts: mocked.load,
  resolveThemeDir: () => themeDir,
}));
const { serveThemeBlockAsset, serveThemeScripts } = await import("../../../../src/routes/design/site.js");
const { contentVersion } = await import("../../../../src/lib/themes/theme-asset-versions.js");
let server: Server, base: string;
beforeAll(async () => {
  const app = express(); app.get('/theme.js', serveThemeScripts); app.get(/^\/theme-assets\/(.+)$/, rateLimit({ windowMs: 60_000, limit: 600 }), serveThemeBlockAsset); server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
afterAll(async () => (await import("node:fs")).rmSync(themeDir, { recursive: true, force: true }));
beforeEach(() => {
  mocked.siteId = 'site-a'; mocked.active = { theme_id: 'justflows.voyage', manifest: {} };
  mocked.load.mockReset().mockReturnValue('window.voyage = true;');
});
describe('GET /theme.js', () => {
  it('serves only active-site theme scripts without caching', async () => {
    const response = await fetch(`${base}/theme.js?path=../../secret.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/javascript');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe('window.voyage = true;');
    expect(mocked.load).toHaveBeenCalledWith('justflows.voyage', undefined);
  });
  it('returns an empty bundle without an installation or active theme', async () => {
    mocked.siteId = null;
    expect(await (await fetch(`${base}/theme.js`)).text()).toBe('');
    expect(mocked.load).not.toHaveBeenCalled();
    mocked.siteId = 'site-a'; mocked.active = null;
    expect(await (await fetch(`${base}/theme.js`)).text()).toBe('');
  });
  it('does not expose internal filesystem errors', async () => {
    mocked.load.mockImplementationOnce(() => { throw new Error('/secret/path'); });
    const response = await fetch(`${base}/theme.js`);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('/secret/path');
  });
});
describe('versioned theme assets', () => {
  it('caches /theme.js for good only under its own content version', async () => {
    const good = await fetch(`${base}/theme.js?v=${contentVersion('window.voyage = true;')}`);
    expect(good.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const stale = await fetch(`${base}/theme.js?v=000000000000`);
    expect(stale.headers.get('cache-control')).toBe('no-cache');
  });
  it('serves only files the theme declared in assets.blocks', async () => {
    const good = await fetch(`${base}/theme-assets/assets/lightbox.js?v=${contentVersion('window.lightbox = 1;')}`);
    expect(good.status).toBe(200);
    expect(good.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await good.text()).toBe('window.lightbox = 1;');
    expect((await fetch(`${base}/theme-assets/assets/lightbox.js?v=stale`)).headers.get('cache-control')).toBe('no-cache');
    expect((await fetch(`${base}/theme-assets/assets/private.js`)).status).toBe(404);
    expect((await fetch(`${base}/theme-assets/justflows-theme.json`)).status).toBe(404);
    expect((await fetch(`${base}/theme-assets/..%2Fjustflows-theme.json`)).status).toBe(404);
  });
});
