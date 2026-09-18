import { describe, expect, it } from "vitest";
import { ErrorPageConfigSchema, PICKER_ERROR_CLASSES } from "../error-pages.js";

describe("PICKER_ERROR_CLASSES", () => {
  it("covers the four DB-backed error classes, not 500 or maintenance", () => {
    expect(PICKER_ERROR_CLASSES).toEqual(["404", "403", "410", "429"]);
  });
});

describe("ErrorPageConfigSchema", () => {
  it("accepts an empty config (an unset site behaves like today)", () => {
    const parsed = ErrorPageConfigSchema.safeParse({});
    expect(parsed.success).toBe(true);
  });

  it("accepts theme and builtin sources without a pageId", () => {
    expect(ErrorPageConfigSchema.safeParse({ "404": { source: "theme" } }).success).toBe(true);
    expect(ErrorPageConfigSchema.safeParse({ "403": { source: "builtin" } }).success).toBe(true);
  });

  it("requires a pageId when the source is a page", () => {
    expect(ErrorPageConfigSchema.safeParse({ "404": { source: "page" } }).success).toBe(false);
    expect(
      ErrorPageConfigSchema.safeParse({
        "404": { source: "page", pageId: "2c1d0e8a-4b3f-41a2-9c7d-0e1f2a3b4c5d" },
      }).success,
    ).toBe(true);
  });

  it("rejects a non-UUID pageId", () => {
    expect(
      ErrorPageConfigSchema.safeParse({ "404": { source: "page", pageId: "not-a-uuid" } })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown source", () => {
    expect(ErrorPageConfigSchema.safeParse({ "404": { source: "plugin" } }).success).toBe(false);
  });

  it("accepts 500 and maintenance as plain-text copy, never a source picker", () => {
    const parsed = ErrorPageConfigSchema.safeParse({
      "500": { heading: "Down for maintenance", message: "Back soon." },
      maintenance: { enabled: true, heading: "Scheduled maintenance" },
    });
    expect(parsed.success).toBe(true);
  });

  it("caps the plain-text copy length", () => {
    expect(
      ErrorPageConfigSchema.safeParse({ "500": { heading: "x".repeat(201) } }).success,
    ).toBe(false);
  });
});
