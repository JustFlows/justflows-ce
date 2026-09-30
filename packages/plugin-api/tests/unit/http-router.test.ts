import { describe, expect, it } from "vitest";
import { PluginHttpRouter } from "../../src/http-router.js";

describe("PluginHttpRouter", () => {
  it("rejects well-known path conflicts", () => {
    const router = new PluginHttpRouter();
    router.register("justflows.seo", "GET", "/sitemap.xml", async () => ({ body: "a" }));
    expect(() =>
      router.register("justflows.other", "GET", "/sitemap.xml", async () => ({ body: "b" })),
    ).toThrow(/already claimed/);
  });

  it("matches path parameters and prefers the more specific pattern", () => {
    const router = new PluginHttpRouter();
    router.register("acme.shop", "GET", "/api/v1/shop/products/:id", async () => ({ body: "one" }));
    router.register("acme.shop", "PATCH", "products/:id", async () => ({ body: "patch" }));

    const named = router.match("GET", "/api/v1/shop/products/sku-1");
    expect(named?.params).toEqual({ id: "sku-1" });

    const prefixed = router.match("PATCH", "/ext/acme.shop/products/sku-1");
    expect(prefixed?.route.pluginId).toBe("acme.shop");
    expect(prefixed?.params).toEqual({ id: "sku-1" });
  });

  it("stores the policy the plugin registered and drops it with the plugin", () => {
    const router = new PluginHttpRouter();
    router.register("acme.shop", "POST", "payments/hooks/:gateway/:token", async () => ({ body: "ok" }), {
      csrf: false,
      rawBody: true,
      rateLimit: { limit: 60, windowMs: 60_000, key: "payment-hook" },
    });

    const matched = router.match("POST", "/ext/acme.shop/payments/hooks/stripe/token");
    expect(matched?.route.csrf).toBe(false);
    expect(matched?.route.rawBody).toBe(true);
    expect(matched?.route.rateLimit).toEqual({ limit: 60, windowMs: 60_000, key: "payment-hook" });

    router.removePlugin("acme.shop");
    expect(router.match("POST", "/ext/acme.shop/payments/hooks/stripe/token")).toBeUndefined();
  });

  it("rejects a rate limit that would not hold", () => {
    const router = new PluginHttpRouter();
    expect(() =>
      router.register("acme.shop", "POST", "cart/items", async () => ({ body: "ok" }), {
        rateLimit: { limit: 0, windowMs: 60_000 },
      }),
    ).toThrow(/rate limit/);
    expect(() =>
      router.register("acme.shop", "POST", "cart/items", async () => ({ body: "ok" }), {
        rateLimit: { limit: 30, windowMs: 60_000, key: "../cart" },
      }),
    ).toThrow(/rate-limit key/);
  });
});
