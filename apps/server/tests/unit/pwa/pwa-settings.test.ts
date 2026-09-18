// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PWA_SETTINGS,
  MAX_SHORTCUTS,
  isSafePublicPath,
  normalizePwaSettings,
  pwaEnableRequirementsMet,
} from "../../../src/lib/pwa/pwa-settings.js";

describe("isSafePublicPath", () => {
  it("accepts a same-origin public path", () => {
    expect(isSafePublicPath("/")).toBe(true);
    expect(isSafePublicPath("/blog/hello-world")).toBe(true);
  });

  it("rejects admin, auth, api, and install destinations", () => {
    expect(isSafePublicPath("/admin")).toBe(false);
    expect(isSafePublicPath("/admin/settings")).toBe(false);
    expect(isSafePublicPath("/api/content")).toBe(false);
    expect(isSafePublicPath("/login")).toBe(false);
    expect(isSafePublicPath("/install")).toBe(false);
  });

  it("rejects non-relative or malformed values", () => {
    expect(isSafePublicPath("https://evil.example/")).toBe(false);
    expect(isSafePublicPath("javascript:alert(1)")).toBe(false);
    expect(isSafePublicPath("/foo\\bar")).toBe(false);
    expect(isSafePublicPath("")).toBe(false);
    expect(isSafePublicPath(undefined)).toBe(false);
  });
});

describe("normalizePwaSettings", () => {
  it("fills every field with a safe default from an empty object", () => {
    const s = normalizePwaSettings({});
    expect(s).toEqual(DEFAULT_PWA_SETTINGS);
  });

  it("rejects an unsafe start URL and falls back to the default", () => {
    expect(normalizePwaSettings({ startUrl: "/admin/settings" }).startUrl).toBe("/");
    expect(normalizePwaSettings({ startUrl: "/blog" }).startUrl).toBe("/blog");
  });

  it("rejects an unknown display mode", () => {
    expect(normalizePwaSettings({ display: "popup" }).display).toBe("standalone");
    expect(normalizePwaSettings({ display: "fullscreen" }).display).toBe("fullscreen");
  });

  it("drops an invalid hex color and keeps a valid one", () => {
    expect(normalizePwaSettings({ themeColor: "not-a-color" }).themeColor).toBe(
      DEFAULT_PWA_SETTINGS.themeColor,
    );
    expect(normalizePwaSettings({ themeColor: "#ABCDEF" }).themeColor).toBe("#ABCDEF");
  });

  it("caps shortcuts at the maximum and drops entries without a safe URL", () => {
    const shortcuts = Array.from({ length: 10 }, (_, i) => ({
      name: `Shortcut ${i}`,
      url: `/s${i}`,
    }));
    expect(normalizePwaSettings({ shortcuts }).shortcuts).toHaveLength(MAX_SHORTCUTS);

    const withUnsafe = [
      { name: "Admin", url: "/admin" },
      { name: "Blog", url: "/blog" },
    ];
    const normalized = normalizePwaSettings({ shortcuts: withUnsafe }).shortcuts;
    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.url).toBe("/blog");
  });

  it("rejects an icon URL that isn't same-origin or http(s)", () => {
    expect(normalizePwaSettings({ icon512Url: "javascript:alert(1)" }).icon512Url).toBe("");
    expect(normalizePwaSettings({ icon512Url: "/uploads/icon.png" }).icon512Url).toBe(
      "/uploads/icon.png",
    );
  });

  it("defaults installUi.showLogo to true but honors an explicit false", () => {
    expect(normalizePwaSettings({}).installUi.showLogo).toBe(true);
    expect(normalizePwaSettings({ installUi: { showLogo: false } }).installUi.showLogo).toBe(false);
  });

  it("clamps asset cache bounds", () => {
    const s = normalizePwaSettings({ assetCache: { maxEntries: 999999, maxAgeSeconds: 1 } });
    expect(s.assetCache.maxEntries).toBe(500);
    expect(s.assetCache.maxAgeSeconds).toBe(3600);
  });
});

describe("pwaEnableRequirementsMet", () => {
  it("requires an app name and a 512x512 icon", () => {
    expect(pwaEnableRequirementsMet(DEFAULT_PWA_SETTINGS)).toBe(false);
    expect(
      pwaEnableRequirementsMet({ ...DEFAULT_PWA_SETTINGS, appName: "My Site" }),
    ).toBe(false);
    expect(
      pwaEnableRequirementsMet({
        ...DEFAULT_PWA_SETTINGS,
        appName: "My Site",
        icon512Url: "/uploads/icon-512.png",
      }),
    ).toBe(true);
  });
});
