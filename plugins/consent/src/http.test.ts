import { describe, it, expect } from "vitest";
import { sanitizeConfigPatch, __test__ } from "./http.js";

const { parseChoices, sameChoices, toCsv, deviceFromUa } = __test__;

describe("parseChoices", () => {
  it("keeps necessary on and fills missing categories as false", () => {
    expect(parseChoices("analytics:1")).toEqual({
      necessary: true,
      preferences: false,
      analytics: true,
      marketing: false,
    });
  });
  it("ignores unknown keys", () => {
    expect(parseChoices("evil:1,marketing:1")).toEqual({
      necessary: true,
      preferences: false,
      analytics: false,
      marketing: true,
    });
  });
});

describe("sameChoices", () => {
  it("compares every known category", () => {
    const a = { necessary: true, preferences: false, analytics: true, marketing: false };
    expect(sameChoices(a, { ...a })).toBe(true);
    expect(sameChoices(a, { ...a, analytics: false })).toBe(false);
  });
});

describe("deviceFromUa", () => {
  it("classifies without storing the raw string", () => {
    expect(deviceFromUa("iPhone Mobile Safari")).toBe("mobile");
    expect(deviceFromUa("iPad")).toBe("tablet");
    expect(deviceFromUa("Mozilla/5.0 (Macintosh)")).toBe("desktop");
  });
});

describe("toCsv", () => {
  it("emits a header and one row per record", () => {
    const csv = toCsv([
      {
        cid: "c-1",
        policyVersion: "2",
        policyHash: "abc",
        choices: { necessary: true, preferences: false, analytics: true, marketing: false },
        locale: "en",
        device: "desktop",
        method: "accept-all",
        ts: "2026-09-01T00:00:00.000Z",
      },
    ]);
    const [header, row] = csv.split("\n");
    expect(header).toBe(
      "cid,ts,policyVersion,policyHash,locale,device,method,necessary,preferences,analytics,marketing",
    );
    expect(row).toBe(
      "c-1,2026-09-01T00:00:00.000Z,2,abc,en,desktop,accept-all,true,false,true,false",
    );
  });
});

describe("sanitizeConfigPatch", () => {
  it("keeps only the known top-level keys (coerceConfig does the validation)", () => {
    const patch = sanitizeConfigPatch({
      enabled: true,
      displayMode: "eu",
      design: { layout: "bar" },
      translations: { en: { bannerTitle: "Hi" } },
      somethingElse: "x",
    });
    expect(patch).toEqual({
      enabled: true,
      displayMode: "eu",
      design: { layout: "bar" },
      translations: { en: { bannerTitle: "Hi" } },
    });
    expect(patch).not.toHaveProperty("somethingElse");
  });

  it("returns an empty patch for a non-object body", () => {
    expect(sanitizeConfigPatch("nope")).toEqual({});
    expect(sanitizeConfigPatch(null)).toEqual({});
  });
});
