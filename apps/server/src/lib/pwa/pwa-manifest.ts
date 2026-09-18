// SPDX-License-Identifier: MIT

import type { PwaSettings } from "./pwa-settings.js";

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: "any" | "maskable";
}

interface ManifestShortcut {
  name: string;
  url: string;
  description?: string;
}

export interface PwaManifest {
  id: string;
  name: string;
  short_name: string;
  description?: string;
  start_url: string;
  scope: string;
  display: PwaSettings["display"];
  theme_color: string;
  background_color: string;
  lang: string;
  dir: "ltr";
  icons: ManifestIcon[];
  shortcuts?: ManifestShortcut[];
}

function absoluteIconUrl(origin: string, url: string): string {
  return url.startsWith("http://") || url.startsWith("https://") ? url : `${origin}${url}`;
}

/**
 * Build the web app manifest object from stored settings.
 *
 * `id` and `scope` are always the site root — not settings-derived — per the
 * issue's requirement to never expose an arbitrary service-worker scope.
 * There is no whole-site subdirectory-hosting configuration in this codebase
 * today (only locale URL prefixes and the configurable admin path), so a
 * root scope is also correct for the common reverse-proxy-subdirectory case:
 * Express sees the full forwarded path either way.
 */
export function buildManifestJson(settings: PwaSettings, origin: string, locale: string): PwaManifest {
  const icons: ManifestIcon[] = [];
  if (settings.icon192Url) {
    icons.push({
      src: absoluteIconUrl(origin, settings.icon192Url),
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    });
  }
  if (settings.icon512Url) {
    icons.push({
      src: absoluteIconUrl(origin, settings.icon512Url),
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    });
  }
  if (settings.maskableIcon192Url) {
    icons.push({
      src: absoluteIconUrl(origin, settings.maskableIcon192Url),
      sizes: "192x192",
      type: "image/png",
      purpose: "maskable",
    });
  }
  if (settings.maskableIcon512Url) {
    icons.push({
      src: absoluteIconUrl(origin, settings.maskableIcon512Url),
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    });
  }

  const manifest: PwaManifest = {
    id: "/",
    name: settings.appName || "Website",
    short_name: settings.shortName || settings.appName || "Website",
    start_url: settings.startUrl || "/",
    scope: "/",
    display: settings.display,
    theme_color: settings.themeColor,
    background_color: settings.backgroundColor,
    lang: locale || "en",
    dir: "ltr",
    icons,
  };
  if (settings.description) manifest.description = settings.description;
  if (settings.shortcuts.length > 0) {
    manifest.shortcuts = settings.shortcuts.map((s) => ({
      name: s.name,
      url: s.url,
      ...(s.description ? { description: s.description } : {}),
    }));
  }
  return manifest;
}
