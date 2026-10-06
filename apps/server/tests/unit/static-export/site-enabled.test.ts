// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { siteAllowsStaticExport } from "../../../src/lib/static-export/site-enabled.js";

describe("site static export switch", () => {
  it("leaves export on until the website stores false", () => {
    expect(siteAllowsStaticExport(undefined)).toBe(true);
    expect(siteAllowsStaticExport(null)).toBe(true);
    expect(siteAllowsStaticExport(true)).toBe(true);
  });

  it("turns export off only for a stored false", () => {
    expect(siteAllowsStaticExport(false)).toBe(false);
    expect(siteAllowsStaticExport("false")).toBe(false);
    expect(siteAllowsStaticExport(0)).toBe(false);
    expect(siteAllowsStaticExport("0")).toBe(false);
  });
});
