// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { buildManifestJson } from "../pwa-manifest.js";
import { DEFAULT_PWA_SETTINGS, type PwaSettings } from "../pwa-settings.js";

const base: PwaSettings = {
  ...DEFAULT_PWA_SETTINGS,
  enabled: true,
  appName: "My Site",
  shortName: "MySite",
  icon192Url: "/uploads/icon-192.png",
  icon512Url: "/uploads/icon-512.png",
};

describe("buildManifestJson", () => {
  it("always uses the site root as id and scope, never a settings value", () => {
    const manifest = buildManifestJson(base, "https://example.com", "en");
    expect(manifest.id).toBe("/");
    expect(manifest.scope).toBe("/");
  });

  it("lists both icon sizes with purpose 'any'", () => {
    const manifest = buildManifestJson(base, "https://example.com", "en");
    expect(manifest.icons).toEqual([
      { src: "https://example.com/uploads/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "https://example.com/uploads/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ]);
  });

  it("adds maskable icon entries only when configured", () => {
    const withMaskable = buildManifestJson(
      { ...base, maskableIcon192Url: "/uploads/m-192.png", maskableIcon512Url: "/uploads/m-512.png" },
      "https://example.com",
      "en",
    );
    expect(withMaskable.icons.filter((i) => i.purpose === "maskable")).toHaveLength(2);
    expect(buildManifestJson(base, "https://example.com", "en").icons.some((i) => i.purpose === "maskable")).toBe(
      false,
    );
  });

  it("omits description and shortcuts when unset", () => {
    const manifest = buildManifestJson(base, "https://example.com", "en");
    expect(manifest.description).toBeUndefined();
    expect(manifest.shortcuts).toBeUndefined();
  });

  it("includes shortcuts when configured", () => {
    const manifest = buildManifestJson(
      { ...base, shortcuts: [{ name: "Blog", url: "/blog", description: "" }] },
      "https://example.com",
      "en",
    );
    expect(manifest.shortcuts).toEqual([{ name: "Blog", url: "/blog" }]);
  });

  it("keeps an already-absolute icon URL unchanged", () => {
    const manifest = buildManifestJson(
      { ...base, icon512Url: "https://cdn.example.com/icon.png" },
      "https://example.com",
      "en",
    );
    expect(manifest.icons.find((i) => i.sizes === "512x512")?.src).toBe(
      "https://cdn.example.com/icon.png",
    );
  });
});
