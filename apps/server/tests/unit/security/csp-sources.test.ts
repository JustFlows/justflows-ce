// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { applyCspSources, isPluginCspSource } from "../../../src/lib/security/csp-sources.js";

const PUBLIC = "default-src 'self'; object-src 'none'; script-src 'self'";

describe("applyCspSources", () => {
  it("allows the payment button script, frame, and API", () => {
    const csp = applyCspSources(PUBLIC, {
      "script-src": ["https://js.payments.example", "https://*.js.payments.example"],
      "frame-src": ["https://js.payments.example", "https://*.js.payments.example", "https://checkout.payments.example"],
      "connect-src": ["https://api.payments.example"],
      "img-src": ["https://*.payments.example"],
    });
    expect(csp).toContain("script-src 'self' https://js.payments.example https://*.js.payments.example");
    expect(csp).toContain("frame-src 'self' https://js.payments.example https://*.js.payments.example https://checkout.payments.example");
    expect(csp).toContain("connect-src 'self' https://api.payments.example");
    expect(csp).toContain("img-src 'self' https://*.payments.example");
    expect(csp).toContain("object-src 'none'");
  });

  it("drops keywords, paths, and plain http", () => {
    expect(isPluginCspSource("https://js.payments.example")).toBe(true);
    expect(isPluginCspSource("https://*.payments.example")).toBe(true);
    expect(isPluginCspSource("'unsafe-inline'")).toBe(false);
    expect(isPluginCspSource("*")).toBe(false);
    expect(isPluginCspSource("http://js.payments.example")).toBe(false);
    expect(isPluginCspSource("https://js.payments.example/v3/buy-button.js")).toBe(false);
    const csp = applyCspSources("script-src 'self'", {
      "script-src": ["'unsafe-inline'", "https://js.payments.example/v3/buy-button.js", "https://js.payments.example"],
    });
    expect(csp).toBe("script-src 'self' https://js.payments.example");
  });
});
