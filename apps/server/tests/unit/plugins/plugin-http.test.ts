// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { pluginRouteRateBucket, requiresPluginCsrf } from "../../../src/lib/plugins/plugin-http.js";

describe("requiresPluginCsrf", () => {
  it("allows the public Forms submission route without a session token", () => {
    expect(requiresPluginCsrf("POST", "/justflows-forms/submit")).toBe(false);
  });

  it("keeps CSRF protection on other plugin mutations", () => {
    expect(requiresPluginCsrf("POST", "/some-plugin/action")).toBe(true);
    expect(requiresPluginCsrf("PUT", "/justflows-forms/admin/forms/contact")).toBe(true);
    expect(requiresPluginCsrf("DELETE", "/justflows-forms/admin/submissions/1")).toBe(true);
  });

  it("does not require CSRF for read-only plugin routes", () => {
    expect(requiresPluginCsrf("GET", "/justflows-forms/config")).toBe(false);
  });

  it("skips CSRF only when the registered route opts out", () => {
    expect(requiresPluginCsrf("POST", "/ext/acme.pay/hooks/stripe/token", { csrf: false })).toBe(false);
    expect(requiresPluginCsrf("POST", "/ext/acme.pay/hooks/stripe/token")).toBe(true);
    expect(requiresPluginCsrf("GET", "/ext/acme.shop/checkout/return")).toBe(false);
  });
});

describe("pluginRouteRateBucket", () => {
  it("uses the plugin id and the key the route registered", () => {
    expect(
      pluginRouteRateBucket({
        pluginId: "acme.shop",
        path: "/ext/acme.shop/cart/items",
        rateLimit: { limit: 30, windowMs: 60_000, key: "cart" },
      }),
    ).toEqual({
      bucket: "plugin:acme.shop:cart",
      limit: 30,
      windowMs: 60_000,
    });
  });

  it("falls back to the route path and skips routes that did not ask", () => {
    expect(
      pluginRouteRateBucket({
        pluginId: "acme.shop",
        path: "/ext/acme.shop/storefront",
        rateLimit: { limit: 60, windowMs: 60_000 },
      })?.bucket,
    ).toBe("plugin:acme.shop:/ext/acme.shop/storefront");
    expect(pluginRouteRateBucket({ pluginId: "acme.shop", path: "/ext/acme.shop/cart" })).toBeNull();
  });
});
