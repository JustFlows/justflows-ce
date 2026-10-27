// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  crossOriginResourcePolicyForHosts,
  cspOrigin,
  frameAncestorsListsOrigins,
  siteHostsForCsp,
  withSiteOriginCsp,
} from "../../../src/lib/security/site-origin-csp.js";

const ADMIN = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "connect-src 'self'",
].join("; ");

const PUBLIC = "default-src 'self'; frame-ancestors 'self'; script-src 'self'; connect-src 'self'; frame-src 'self'";

const ORIGINS = ["https://noobbase.justflows.com", "https://noobbase.com"];

describe("siteHostsForCsp", () => {
  it("includes the platform address and a connected custom domain", () => {
    expect(
      siteHostsForCsp([
        { hostname: "noobbase.justflows.com", kind: "subdomain", status: "active" },
        { hostname: "noobbase.com", kind: "custom", status: "active" },
        { hostname: "waiting.example", kind: "custom", status: "pending" },
      ]),
    ).toEqual(["https://noobbase.justflows.com", "https://noobbase.com"]);
  });

  it("rejects a hostname that is not safe to embed in a policy", () => {
    expect(cspOrigin("evil.test/path")).toBeNull();
    expect(cspOrigin("*.example.com")).toBeNull();
    expect(cspOrigin("noobbase.com")).toBe("https://noobbase.com");
  });
});

describe("withSiteOriginCsp", () => {
  it("lets the admin load and call the custom domain without framing the admin", () => {
    const csp = withSiteOriginCsp(ADMIN, ORIGINS, { frameAncestors: false });
    expect(csp).toContain("script-src 'self' https://noobbase.justflows.com https://noobbase.com");
    expect(csp).toContain("connect-src 'self' https://noobbase.justflows.com https://noobbase.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it("lets the platform address frame the public site", () => {
    const csp = withSiteOriginCsp(PUBLIC, ORIGINS, { frameAncestors: true });
    expect(csp).toContain(
      "frame-ancestors 'self' https://noobbase.justflows.com https://noobbase.com",
    );
    expect(csp).toContain("frame-src 'self' https://noobbase.justflows.com https://noobbase.com");
    expect(frameAncestorsListsOrigins(csp)).toBe(true);
  });

  it("keeps X-Frame-Options in charge until frame-ancestors names an origin", () => {
    expect(frameAncestorsListsOrigins("frame-ancestors 'self'")).toBe(false);
    expect(frameAncestorsListsOrigins("frame-ancestors 'none'")).toBe(false);
    expect(frameAncestorsListsOrigins("default-src 'self'")).toBe(false);
  });

  it("does not repeat an origin or accept a source with a path", () => {
    const once = withSiteOriginCsp("script-src 'self' https://noobbase.com", ["https://noobbase.com"], {
      frameAncestors: false,
    });
    expect(once).toBe("script-src 'self' https://noobbase.com");
    expect(withSiteOriginCsp("script-src 'self'", ["https://evil.test/popup.js"], { frameAncestors: false })).toBe(
      "script-src 'self'",
    );
  });
});

describe("crossOriginResourcePolicyForHosts", () => {
  it("relaxes same-site when the custom domain is a different site", () => {
    expect(crossOriginResourcePolicyForHosts("same-site", ORIGINS)).toBe("cross-origin");
  });

  it("keeps same-site for one host and for www on the same domain", () => {
    expect(crossOriginResourcePolicyForHosts("same-site", ["https://noobbase.com"])).toBe("same-site");
    expect(
      crossOriginResourcePolicyForHosts("same-site", ["https://noobbase.com", "https://www.noobbase.com"]),
    ).toBe("same-site");
  });
});
