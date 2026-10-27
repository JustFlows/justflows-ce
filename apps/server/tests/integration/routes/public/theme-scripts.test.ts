// SPDX-License-Identifier: MIT
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ siteId: "site-a" as string | null, active: { theme_id: "justflows.voyage", manifest: {} } as { theme_id: string; manifest: Record<string, unknown> } | null, load: vi.fn(() => 'window.voyage = true;') }));
vi.mock("../../../../src/lib/themes/themes-db.js", () => ({
  ensureThemesTable: async () => {}, getSiteId: async () => mocked.siteId,
  getActiveTheme: async () => mocked.active, themeInstalledPath: () => null,
}));
vi.mock("../../../../src/lib/themes/theme-files.js", async original => ({
  ...await original<typeof import("../../../../src/lib/themes/theme-files.js")>(), loadThemeScripts: mocked.load,
}));
const { serveThemeScripts } = await import("../../../../src/routes/design/site.js");
let server: Server, base: string;
beforeAll(async () => {
  const app = express(); app.get('/theme.js', serveThemeScripts); server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
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
