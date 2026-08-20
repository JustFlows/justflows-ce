import { describe, expect, it } from "vitest";
import { PluginHttpRouter } from "../http-router.js";

describe("PluginHttpRouter", () => {
  it("rejects well-known path conflicts", () => {
    const router = new PluginHttpRouter();
    router.register("justflows.seo", "GET", "/sitemap.xml", async () => ({ body: "a" }));
    expect(() =>
      router.register("justflows.other", "GET", "/sitemap.xml", async () => ({ body: "b" })),
    ).toThrow(/already claimed/);
  });
});
