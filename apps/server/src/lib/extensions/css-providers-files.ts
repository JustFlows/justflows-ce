import path from "node:path";
import {
  cssProvidersInstallDir,
  resolveInstalledAssetPath,
} from "./css-provider-install.js";
import type { CssProviderRow } from "./css-providers-db.js";

export interface ResolvedCssAsset {
  href?: string;
  src?: string;
  defer?: boolean;
}

function resolveAssetUrl(value: string): string | null {
  if (/^https?:\/\//i.test(value) || value.startsWith("//")) {
    return null;
  }
  // Public URLs never expose node_modules/ — that stays an install detail.
  const normalized = value
    .replace(/^\.?\//, "")
    .replace(/^node_modules\//, "");
  if (!normalized) return null;
  return `/css-providers/${normalized.split("/").map(encodeURIComponent).join("/")}`;
}

function parseAsset(raw: unknown, kind: "stylesheet" | "script"): ResolvedCssAsset | null {
  if (typeof raw === "string") {
    const url = resolveAssetUrl(raw);
    if (!url) return null;
    return kind === "stylesheet" ? { href: url } : { src: url };
  }

  if (!raw || typeof raw !== "object") return null;
  const asset = raw as Record<string, unknown>;
  const key = kind === "stylesheet" ? "href" : "src";
  const value = asset[key] ?? asset.href ?? asset.src;
  if (typeof value !== "string" || !value) return null;

  const url = resolveAssetUrl(value);
  if (!url) return null;

  const resolved: ResolvedCssAsset = { [key]: url };
  if (asset.defer === true) resolved.defer = true;
  return resolved;
}

export function resolveProviderAssets(provider: CssProviderRow | null): {
  stylesheets: ResolvedCssAsset[];
} {
  if (!provider || provider.provider_id === "justflows.none") {
    return { stylesheets: [] };
  }

  const manifest = provider.manifest ?? {};
  const rawStylesheets = Array.isArray(manifest.stylesheets) ? manifest.stylesheets : [];

  const stylesheets = rawStylesheets
    .map((item) => parseAsset(item, "stylesheet"))
    .filter((item): item is ResolvedCssAsset => item !== null && Boolean(item.href))
    .filter((item) => assetExists(item.href!));

  return { stylesheets };
}

function assetExists(apiPath: string): boolean {
  const prefix = "/css-providers/";
  if (!apiPath.startsWith(prefix)) return false;
  const relative = decodeURIComponent(apiPath.slice(prefix.length));
  return resolveInstalledAssetPath(relative) !== null;
}

export function resolveAssetFilePath(relativePath: string): string | null {
  return resolveInstalledAssetPath(relativePath);
}

export function getCssProviderAssetsRoot(): string {
  return cssProvidersInstallDir();
}
