import { describe, expect, it } from "vitest";
import {
  compareCoreVersions,
  isAutoUpdateEligible,
  parseCoreVersion,
} from "../core-release-check.js";

const cmp = (a: string, b: string) =>
  compareCoreVersions(parseCoreVersion(a)!, parseCoreVersion(b)!);

describe("parseCoreVersion", () => {
  it("accepts a leading v and a prerelease identifier", () => {
    expect(parseCoreVersion("v0.1.5")).toEqual({ major: 0, minor: 1, patch: 5, prerelease: [] });
    expect(parseCoreVersion("0.2.0-rc.1")).toEqual({
      major: 0,
      minor: 2,
      patch: 0,
      prerelease: ["rc", "1"],
    });
    expect(parseCoreVersion("0.1.7-dev+build.12")).toEqual({
      major: 0,
      minor: 1,
      patch: 7,
      prerelease: ["dev"],
    });
  });

  it("rejects anything that is not X.Y.Z", () => {
    expect(parseCoreVersion("unknown")).toBeNull();
    expect(parseCoreVersion("1.2")).toBeNull();
    expect(parseCoreVersion("01.2.3")).toBeNull();
    expect(parseCoreVersion("1.2.3-rc.01")).toBeNull();
    expect(parseCoreVersion("1.2.3-rc..1")).toBeNull();
  });
});

describe("compareCoreVersions", () => {
  it("orders by major, minor, then patch, with prereleases ranked lower", () => {
    expect(cmp("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(cmp("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(cmp("0.1.5", "0.1.5")).toBe(0);
    expect(cmp("0.2.0-rc.1", "0.2.0")).toBeLessThan(0);
  });

  it("follows the canonical SemVer prerelease precedence chain", () => {
    const versions = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];

    for (let i = 0; i < versions.length - 1; i++) {
      expect(cmp(versions[i]!, versions[i + 1]!)).toBeLessThan(0);
    }
  });

  it("ranks development and release-candidate builds below the matching stable release", () => {
    expect(cmp("0.1.7-dev", "0.1.7")).toBeLessThan(0);
    expect(cmp("0.1.7-rc", "0.1.7")).toBeLessThan(0);
  });
});

describe("isAutoUpdateEligible", () => {
  it("allows a higher release inside the same major line", () => {
    expect(isAutoUpdateEligible("0.1.5", "0.1.6")).toBe(true);
    expect(isAutoUpdateEligible("0.1.5", "0.2.0")).toBe(true);
    expect(isAutoUpdateEligible("1.4.0", "1.9.3")).toBe(true);
    expect(isAutoUpdateEligible("0.1.7-dev", "0.1.7")).toBe(true);
    expect(isAutoUpdateEligible("0.1.7-rc", "0.1.7")).toBe(true);
  });

  it("never crosses a major version", () => {
    expect(isAutoUpdateEligible("0.9.9", "1.0.0")).toBe(false);
    expect(isAutoUpdateEligible("1.2.0", "2.0.0")).toBe(false);
  });

  it("does not act on same or older versions, or on prereleases", () => {
    expect(isAutoUpdateEligible("0.1.5", "0.1.5")).toBe(false);
    expect(isAutoUpdateEligible("0.2.0", "0.1.9")).toBe(false);
    expect(isAutoUpdateEligible("0.1.5", "0.2.0-rc.1")).toBe(false);
    expect(isAutoUpdateEligible("0.1.5", "not-a-version")).toBe(false);
  });
});
