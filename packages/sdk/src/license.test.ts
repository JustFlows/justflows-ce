import { describe, expect, it } from "vitest";
import { gplLicenseValidationMessage, isGplCompatibleLicense } from "./license.js";

describe("isGplCompatibleLicense", () => {
  it("accepts recommended Justflows license", () => {
    expect(isGplCompatibleLicense("GPL-2.0-or-later")).toBe(true);
  });

  it("accepts MIT as GPL-compatible", () => {
    expect(isGplCompatibleLicense("MIT")).toBe(true);
  });

  it("accepts compound OR expressions when all parts are compatible", () => {
    expect(isGplCompatibleLicense("GPL-2.0-or-later OR MIT")).toBe(true);
  });

  it("rejects missing license", () => {
    expect(isGplCompatibleLicense(undefined)).toBe(false);
    expect(isGplCompatibleLicense("")).toBe(false);
  });

  it("rejects proprietary licenses", () => {
    expect(isGplCompatibleLicense("Proprietary")).toBe(false);
    expect(isGplCompatibleLicense("Commercial")).toBe(false);
  });

  it("provides helpful validation messages", () => {
    expect(gplLicenseValidationMessage(undefined)).toContain("GPL-compatible");
    expect(gplLicenseValidationMessage("Proprietary")).toContain("Proprietary");
  });
});
