import { describe, expect, it } from "vitest";
import { parseBlogPageId } from "../blog-page.js";

describe("parseBlogPageId", () => {
  it("accepts a UUID and rejects anything else", () => {
    expect(parseBlogPageId("2c1d0e8a-4b3f-41a2-9c7d-0e1f2a3b4c5d")).toBe(
      "2c1d0e8a-4b3f-41a2-9c7d-0e1f2a3b4c5d",
    );
    expect(parseBlogPageId(" 2c1d0e8a-4b3f-41a2-9c7d-0e1f2a3b4c5d ")).toBe(
      "2c1d0e8a-4b3f-41a2-9c7d-0e1f2a3b4c5d",
    );
    expect(parseBlogPageId("blog")).toBeNull();
    expect(parseBlogPageId(null)).toBeNull();
    expect(parseBlogPageId(12)).toBeNull();
  });
});
