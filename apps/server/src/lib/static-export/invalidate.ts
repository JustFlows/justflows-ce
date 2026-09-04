// SPDX-License-Identifier: MIT

import type { CacheRevalidateTrigger } from "@justflows/sdk";
import type { StaticExportManifest } from "./manifest.js";

export interface AffectedSelection {
  /** URL paths to re-crawl. Empty with `all: true` means "everything". */
  paths: string[];
  /** Re-crawl every route (chrome-wide change: theme, menu, settings, …). */
  all: boolean;
  /** Re-download referenced assets (`/theme.css` and friends change with the theme). */
  assets: boolean;
  reason: string;
}

/** Triggers that change site-wide chrome and therefore every page. */
const GLOBAL_TRIGGERS = new Set<CacheRevalidateTrigger>([
  "menus",
  "theme",
  "settings",
  "cssProviders",
  "manual",
  "plugin",
]);

/**
 * Given a `cache.revalidated` trigger and the previous manifest, decide which
 * routes an incremental export must rebuild.
 *
 * - `content` with ids → the routes that embed those ids, their translation
 *   siblings, every route flagged `dynamicList` (blog lists / archives), the
 *   home page, and `sitemap.xml` / the 404.
 * - `content` without ids, or any global trigger → rebuild everything.
 */
export function computeAffected(
  trigger: CacheRevalidateTrigger,
  manifest: StaticExportManifest | null,
  opts: { contentIds?: string[]; translationGroupIds?: string[] } = {},
): AffectedSelection {
  if (GLOBAL_TRIGGERS.has(trigger)) {
    return { paths: [], all: true, assets: true, reason: `${trigger} change (site-wide)` };
  }

  const contentIds = new Set(opts.contentIds ?? []);
  const groupIds = new Set(opts.translationGroupIds ?? []);

  if (trigger === "content" && contentIds.size === 0 && groupIds.size === 0) {
    return { paths: [], all: true, assets: false, reason: "content change (targets unknown)" };
  }
  if (!manifest) {
    return { paths: [], all: true, assets: false, reason: "no previous manifest" };
  }

  const paths = new Set<string>();
  for (const route of manifest.routes) {
    const hitsId = route.deps.content.some((id) => contentIds.has(id));
    const hitsGroup = route.deps.translationGroups.some((g) => groupIds.has(g));
    if (hitsId || hitsGroup || route.deps.dynamicList || route.path === "/") {
      paths.add(route.path);
    }
    if (/\/(sitemap\.xml)$/i.test(route.path)) paths.add(route.path);
  }
  paths.add("/sitemap.xml");

  return {
    paths: [...paths],
    all: false,
    assets: false,
    reason: `content change (${contentIds.size} id(s), ${groupIds.size} group(s))`,
  };
}
