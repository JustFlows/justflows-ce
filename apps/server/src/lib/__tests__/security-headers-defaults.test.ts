import { describe, expect, it } from "vitest";
import {
  defaultConfig,
  normalizeConfig,
  recommendedConfig,
  resolveHeaders,
} from "../security-headers.js";

const publicCtx = { area: "public", secure: true } as const;
const adminCtx = { area: "admin", secure: true } as const;

function header(list: { name: string; value: string }[], name: string): string | undefined {
  return list.find((h) => h.name === name)?.value;
}

describe("shipped security header defaults", () => {
  it("sends an enforcing CSP on the public site out of the box", () => {
    const headers = resolveHeaders(defaultConfig(), publicCtx);
    const csp = header(headers, "Content-Security-Policy");
    expect(csp).toBeDefined();
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(header(headers, "Content-Security-Policy-Report-Only")).toBeUndefined();
  });

  // Was: "leaves the React admin alone, since its scope is public-only". That
  // left the one surface whose session can install extensions and replace the
  // core running with no policy at all.
  it("sends a strict enforcing CSP on the admin out of the box", () => {
    const headers = resolveHeaders(defaultConfig(), adminCtx);
    const csp = header(headers, "Content-Security-Policy");
    expect(csp).toBeDefined();
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    // Stricter than the public policy: no inline script, no wildcard host.
    expect(csp).not.toContain("'unsafe-inline'; script-src");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(header(headers, "Content-Security-Policy-Report-Only")).toBeUndefined();
  });

  it("keeps the public and admin policies independent", () => {
    const cfg = defaultConfig();
    cfg.headers.content_security_policy.enabled = false;
    // Turning the public policy off must not disarm the admin.
    expect(header(resolveHeaders(cfg, publicCtx), "Content-Security-Policy")).toBeUndefined();
    expect(header(resolveHeaders(cfg, adminCtx), "Content-Security-Policy")).toBeDefined();
  });

  it("matches the policy root server.js emits before Express exists", async () => {
    const { createRequire } = await import("node:module");
    const { getJfRoot } = await import("../jf-root.js");
    const path = await import("node:path");
    const file = path.join(getJfRoot(), "scripts", "security-headers.cjs");
    const cjs = createRequire(file)(file) as { ADMIN_CSP: string };
    // /login and /assets/* are served by server.js under Passenger and by
    // Express otherwise. Two different policies on the same bundle would be
    // worse than one.
    expect(header(resolveHeaders(defaultConfig(), adminCtx), "Content-Security-Policy")).toBe(
      cjs.ADMIN_CSP,
    );
  });

  it("still sends the headers that were already on by default", () => {
    const headers = resolveHeaders(defaultConfig(), publicCtx);
    expect(header(headers, "X-Content-Type-Options")).toBe("nosniff");
    expect(header(headers, "X-Frame-Options")).toBe("SAMEORIGIN");
    expect(header(headers, "Referrer-Policy")).toBeDefined();
  });

  it("does not let the recommended configuration downgrade CSP to report-only", () => {
    expect(recommendedConfig().headers.content_security_policy.mode).toBe("enforce");
  });

  it("honours a stored config that deliberately turned CSP off", () => {
    const stored = defaultConfig();
    stored.headers.content_security_policy.enabled = false;
    const merged = normalizeConfig(JSON.parse(JSON.stringify(stored)));
    expect(merged.headers.content_security_policy.enabled).toBe(false);
    expect(header(resolveHeaders(merged, publicCtx), "Content-Security-Policy")).toBeUndefined();
  });
});
