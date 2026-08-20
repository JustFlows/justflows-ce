import { describe, expect, it } from "vitest";
import {
  DATE_FORMAT_PRESETS,
  formatPhpDate,
  isValidTimeZone,
  previewPhpDate,
} from "../datetime-format.js";

describe("formatPhpDate", () => {
  const noonUtc = new Date("2026-08-20T12:00:00.000Z");

  it("formats WordPress date presets in UTC", () => {
    expect(formatPhpDate(noonUtc, "F j, Y", { timeZone: "UTC" })).toBe("August 20, 2026");
    expect(formatPhpDate(noonUtc, "Y-m-d", { timeZone: "UTC" })).toBe("2026-08-20");
    expect(formatPhpDate(noonUtc, "m/d/Y", { timeZone: "UTC" })).toBe("08/20/2026");
    expect(formatPhpDate(noonUtc, "d/m/Y", { timeZone: "UTC" })).toBe("20/08/2026");
  });

  it("formats WordPress time presets in UTC", () => {
    expect(formatPhpDate(noonUtc, "g:i a", { timeZone: "UTC" })).toBe("12:00 pm");
    expect(formatPhpDate(noonUtc, "g:i A", { timeZone: "UTC" })).toBe("12:00 PM");
    expect(formatPhpDate(noonUtc, "H:i", { timeZone: "UTC" })).toBe("12:00");
  });

  it("applies IANA timezones", () => {
    expect(formatPhpDate(noonUtc, "H:i", { timeZone: "Europe/Amsterdam" })).toBe("14:00");
    expect(formatPhpDate(noonUtc, "Y-m-d H:i", { timeZone: "America/New_York" })).toBe("2026-08-20 08:00");
  });

  it("treats backslash as an escape", () => {
    expect(formatPhpDate(noonUtc, "\\Y Y", { timeZone: "UTC" })).toBe("Y 2026");
  });

  it("emits ordinal suffixes", () => {
    expect(formatPhpDate(new Date("2026-08-01T12:00:00.000Z"), "jS", { timeZone: "UTC" })).toBe("1st");
    expect(formatPhpDate(new Date("2026-08-02T12:00:00.000Z"), "jS", { timeZone: "UTC" })).toBe("2nd");
    expect(formatPhpDate(new Date("2026-08-03T12:00:00.000Z"), "jS", { timeZone: "UTC" })).toBe("3rd");
    expect(formatPhpDate(new Date("2026-08-11T12:00:00.000Z"), "jS", { timeZone: "UTC" })).toBe("11th");
  });

  it("validates timezone identifiers", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Europe/Amsterdam")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });

  it("previews every bundled date preset", () => {
    for (const format of DATE_FORMAT_PRESETS) {
      expect(previewPhpDate(format, "UTC", noonUtc).length).toBeGreaterThan(0);
    }
  });
});
