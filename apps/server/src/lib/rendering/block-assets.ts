// SPDX-License-Identifier: MIT

import { blockAssetMarker } from "@justflows/blocks";

/** Files one block type needs, as a plugin or theme declares them in `assets.blocks`. */
export interface BlockAssetEntry {
  type: string;
  scripts: readonly string[];
  styles: readonly string[];
  /** The URL to link for one of this entry's files. */
  href: (rel: string) => string;
}

/**
 * Tags for the entries whose block type the finished page `html` renders (its
 * `<!--jf-block:<type>-->` marker is present): stylesheets for the head,
 * deferred scripts for the end of the body. A file shared by several block
 * types, or declared twice, is linked once.
 */
export function blockAssetTags(entries: Iterable<BlockAssetEntry>, html: string): { head: string[]; body: string[] } {
  const head: string[] = [];
  const body: string[] = [];
  if (!html.includes("<!--jf-block:")) return { head, body };
  const seen = new Set<string>();
  for (const entry of entries) {
    const marker = blockAssetMarker(entry.type);
    if (!marker || !html.includes(marker)) continue;
    for (const [rels, list, tag] of [
      [entry.styles, head, (href: string) => `<link rel="stylesheet" href="${href}">`],
      [entry.scripts, body, (href: string) => `<script src="${href}" defer></script>`],
    ] as const) {
      for (const rel of rels) {
        const href = entry.href(rel);
        if (seen.has(href)) continue;
        seen.add(href);
        list.push(tag(href));
      }
    }
  }
  return { head, body };
}
