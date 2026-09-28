// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { isShopCartMutation, isShopCheckoutMutation, isShopCheckoutReturn, requiresPluginCsrf } from "../../../src/lib/plugins/plugin-http.js";

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

  it("rate-limits shop cart writes and still requires a CSRF token", () => {
    expect(isShopCartMutation("POST", "/ext/justflows.shop/cart/items")).toBe(true);
    expect(isShopCartMutation("POST", "/ext/justflows.shop/cart/lines")).toBe(true);
    expect(isShopCartMutation("GET", "/ext/justflows.shop/cart")).toBe(false);
    expect(requiresPluginCsrf("POST", "/ext/justflows.shop/cart/items")).toBe(true);
    expect(isShopCheckoutMutation("POST", "/ext/justflows.shop/checkout")).toBe(true);
    expect(isShopCheckoutMutation("POST", "/ext/justflows.shop/checkout/quote")).toBe(true);
    expect(isShopCheckoutMutation("GET", "/ext/justflows.shop/checkout")).toBe(false);
    expect(isShopCheckoutReturn("GET", "/ext/justflows.shop/checkout/return")).toBe(true);
    expect(isShopCheckoutReturn("POST", "/ext/justflows.shop/checkout/return")).toBe(false);
    expect(requiresPluginCsrf("POST", "/ext/justflows.shop/checkout")).toBe(true);
    expect(requiresPluginCsrf("GET", "/ext/justflows.shop/checkout/return")).toBe(false);
  });

  it("lets a signed shop payment webhook through without a session token", () => {
    expect(requiresPluginCsrf("POST", "/ext/justflows.shop/payments/hooks/stripe/abc123def4567890abcd")).toBe(false);
    expect(requiresPluginCsrf("POST", "/ext/justflows.shop/payments")).toBe(true);
  });
});
