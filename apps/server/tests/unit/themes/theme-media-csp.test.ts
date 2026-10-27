// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { withThemeMediaCsp } from "../../../src/lib/themes/theme-media-csp.js";

describe("theme media CSP", () => {
  it("adds only exact HTTPS media hosts, retaining inherited sources and every other directive", () => {
    expect(withThemeMediaCsp("default-src 'self'; script-src 'self'; object-src 'none'", ['https://media.test', 'https://media.test', 'https://evil.test/path', 'https://user:pass@evil.test', '*', 'data:', 'http://media.test']))
      .toBe("default-src 'self'; script-src 'self'; object-src 'none'; media-src 'self' https://media.test");
  });
  it("respects explicit media restrictions and a deny-all default", () => {
    for (const policy of ["default-src 'self'; media-src 'none'", "default-src 'none'", "media-src 'self'"]) {
      expect(withThemeMediaCsp(policy, ['https://media.test'])).toBe(policy);
    }
  });
  it("leaves themes without valid media dependencies unchanged", () => {
    expect(withThemeMediaCsp("default-src 'self'", [])).toBe("default-src 'self'");
  });
});
