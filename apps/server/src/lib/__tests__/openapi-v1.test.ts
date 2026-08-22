import { describe, expect, it } from "vitest";
import { PUBLIC_API_OPENAPI } from "../openapi-v1.js";

describe("public OpenAPI document", () => {
  it("describes the v1 content, types, media, and menus surfaces", () => {
    expect(PUBLIC_API_OPENAPI.openapi).toBe("3.1.0");
    expect(PUBLIC_API_OPENAPI.paths["/content"]).toBeDefined();
    expect(PUBLIC_API_OPENAPI.paths["/content/{slug}"]).toBeDefined();
    expect(PUBLIC_API_OPENAPI.paths["/content-types"]).toBeDefined();
    expect(PUBLIC_API_OPENAPI.paths["/media"]).toBeDefined();
    expect(PUBLIC_API_OPENAPI.paths["/menus"]).toBeDefined();
    expect(PUBLIC_API_OPENAPI.paths["/openapi.json"]).toBeDefined();
  });
});
