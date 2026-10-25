// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { applyCspSources, isPluginCspSource } from "../../../src/lib/security/csp-sources.js";

const PUBLIC = "default-src 'self'; object-src 'none'; script-src 'self'";

describe("applyCspSources", () => {
  it("allows the Stripe buy button script, frame, and API", () => {
    const csp = applyCspSources(PUBLIC, {
      "script-src": ["https://js.stripe.com", "https://*.js.stripe.com"],
      "frame-src": ["https://js.stripe.com", "https://*.js.stripe.com", "https://checkout.stripe.com"],
      "connect-src": ["https://api.stripe.com"],
      "img-src": ["https://*.stripe.com"],
    });
    expect(csp).toContain("script-src 'self' https://js.stripe.com https://*.js.stripe.com");
    expect(csp).toContain("frame-src 'self' https://js.stripe.com https://*.js.stripe.com https://checkout.stripe.com");
    expect(csp).toContain("connect-src 'self' https://api.stripe.com");
    expect(csp).toContain("img-src 'self' https://*.stripe.com");
    expect(csp).toContain("object-src 'none'");
  });

  it("drops keywords, paths, and plain http", () => {
    expect(isPluginCspSource("https://js.stripe.com")).toBe(true);
    expect(isPluginCspSource("https://*.stripe.com")).toBe(true);
    expect(isPluginCspSource("'unsafe-inline'")).toBe(false);
    expect(isPluginCspSource("*")).toBe(false);
    expect(isPluginCspSource("http://js.stripe.com")).toBe(false);
    expect(isPluginCspSource("https://js.stripe.com/v3/buy-button.js")).toBe(false);
    const csp = applyCspSources("script-src 'self'", {
      "script-src": ["'unsafe-inline'", "https://js.stripe.com/v3/buy-button.js", "https://js.stripe.com"],
    });
    expect(csp).toBe("script-src 'self' https://js.stripe.com");
  });
});
