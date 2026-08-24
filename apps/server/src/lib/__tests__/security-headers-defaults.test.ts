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

  it("leaves the React admin alone, since its scope is public-only", () => {
    expect(header(resolveHeaders(defaultConfig(), adminCtx), "Content-Security-Policy")).toBeUndefined();
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
