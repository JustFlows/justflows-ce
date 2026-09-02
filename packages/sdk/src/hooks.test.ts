import { describe, it, expect } from "vitest";
import { SYNC_FILTERS } from "./hooks.js";

describe("SYNC_FILTERS", () => {
  it("marks analytics.head as a synchronous render-path filter", () => {
    expect(SYNC_FILTERS).toContain("analytics.head");
  });

  it("keeps the existing sync filters", () => {
    expect(SYNC_FILTERS).toEqual(
      expect.arrayContaining([
        "http.responseHeaders",
        "html.head",
        "site.underConstruction.render",
      ]),
    );
  });
});
