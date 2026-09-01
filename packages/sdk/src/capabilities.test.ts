import { describe, expect, it } from "vitest";
import { effectiveCapabilities, scopeAllows } from "./capabilities.js";

describe("access policies", () => {
  it("layers grants and lets explicit denies win", () => {
    expect(effectiveCapabilities(["content:read", "content:update"], {
      grants: ["content:publish"],
      denies: ["content:update", "content:publish"],
    })).toEqual(["content:read"]);
  });

  it("requires every populated resource scope to match", () => {
    const scope = { contentTypes: ["post"], locales: ["nl-NL"], ownership: "self" as const };
    expect(scopeAllows(scope, { contentType: "post", locale: "nl-NL", ownerId: "user-1" }, "user-1")).toBe(true);
    expect(scopeAllows(scope, { contentType: "page", locale: "nl-NL", ownerId: "user-1" }, "user-1")).toBe(false);
    expect(scopeAllows(scope, { contentType: "post", locale: "en", ownerId: "user-1" }, "user-1")).toBe(false);
    expect(scopeAllows(scope, { contentType: "post", locale: "nl-NL", ownerId: "user-2" }, "user-1")).toBe(false);
  });
});
