// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Custom code through the real security-headers middleware: the shipped,
 * enforced CSP (`script-src 'self'`) gains exactly the live snippets' hashes
 * and allowlisted origins on public pages, and nothing on the admin.
 */
const settings = vi.hoisted(() => new Map<string, unknown>());

vi.mock("../../../src/lib/settings/site-settings.js", () => ({
  getSiteId: async () => "site-1",
  getSiteSetting: async (siteId: string, key: string) => settings.get(`${siteId}:${key}`) ?? null,
  setSiteSetting: async (siteId: string, key: string, value: unknown) => settings.set(`${siteId}:${key}`, value),
}));
vi.mock("../../../src/lib/tenancy/site-features.js", () => ({ siteFeatureEnabled: async () => true }));
vi.mock("../../../src/lib/admin/admin-path.js", () => ({
  getAdminPathConfig: async () => ({ path: "/admin" }),
  toInternalAdminPath: () => null,
}));
vi.mock("../../../src/lib/security/security-headers.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../src/lib/security/security-headers.js")>();
  return { ...real, getSecurityHeadersConfig: async () => real.defaultConfig() };
});
vi.mock("../../../src/lib/themes/theme-media-csp.js", () => ({ getThemeMediaOriginsForCsp: async () => [], withThemeMediaCsp: (csp: string) => csp }));
vi.mock("../../../src/lib/comments/comments-captcha-csp.js", () => ({ getCaptchaProviderForCsp: async () => "none", withCaptchaCsp: (csp: string) => csp }));
vi.mock("../../../src/lib/static-export/config.js", () => ({ getStaticExportConfig: () => ({ originUrl: "" }) }));
vi.mock("../../../src/lib/plugins/plugin-runtime.js", () => ({ getRuntimeHooks: () => ({ has: () => false }) }));
vi.mock("../../../src/lib/security/site-origin-csp.js", () => ({
  getSiteCspOrigins: async () => [],
  withSiteOriginCsp: (csp: string) => csp,
  frameAncestorsListsOrigins: () => false,
  crossOriginResourcePolicyForHosts: (value: string) => value,
}));

const { securityHeaders } = await import("../../../src/middleware/security-headers.js");
const { invalidateCustomCodeCache } = await import("../../../src/lib/custom-code/custom-code.js");

async function cspFor(path: string): Promise<string> {
  const headers = new Map<string, unknown>();
  const res = {
    locals: {},
    setHeader: (name: string, value: unknown) => headers.set(name.toLowerCase(), value),
    getHeader: (name: string) => headers.get(name.toLowerCase()),
    removeHeader: (name: string) => headers.delete(name.toLowerCase()),
  } as unknown as Response;
  await new Promise<void>((resolve) => securityHeaders({ path, secure: true } as Request, res, (() => resolve()) as NextFunction));
  return String(headers.get("content-security-policy") ?? "");
}

const snippet = { enabled: true, scope: { type: "site" }, consent: "necessary", environments: [] };

describe("custom code in the response CSP", () => {
  beforeEach(() => {
    settings.clear();
    invalidateCustomCodeCache();
  });

  it("adds the live inline hashes and allowlisted origins on public pages only", async () => {
    settings.set("site-1:custom_code", {
      allowedOrigins: ["https://cdn.example.com"],
      snippets: [
        { ...snippet, id: "a", name: "A", placement: "head", kind: "inline", code: "window.a=1;" },
        { ...snippet, id: "w", name: "W", placement: "bodyEnd", kind: "external", src: "https://cdn.example.com/w.js" },
      ],
    });
    const hash = `'sha256-${createHash("sha256").update("window.a=1;", "utf8").digest("base64")}'`;
    const publicCsp = await cspFor("/about");
    expect(publicCsp).toMatch(new RegExp(`script-src 'self'[^;]*https://cdn\\.example\\.com[^;]*${hash.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`));
    expect(publicCsp).not.toContain("unsafe-inline' 'sha256");
    expect(publicCsp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    const adminCsp = await cspFor("/admin/security");
    expect(adminCsp).not.toContain(hash);
  });

  it("leaves the policy untouched when there is no live custom code", async () => {
    settings.set("site-1:custom_code", { safeMode: true, allowedOrigins: ["https://cdn.example.com"], snippets: [{ ...snippet, id: "a", name: "A", placement: "head", kind: "inline", code: "x();" }] });
    const csp = await cspFor("/about");
    const hash = `'sha256-${createHash("sha256").update("x();", "utf8").digest("base64")}'`;
    expect(csp).not.toContain(hash);
    expect(csp).not.toContain("cdn.example.com");
  });
});
