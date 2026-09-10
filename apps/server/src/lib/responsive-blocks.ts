// SPDX-License-Identifier: MIT

import type { BlockNode } from "./types.js";
import { GALLERY_BLOCK_TYPE } from "./gallery-public.js";
import {
  isUploadUrl,
  loadResponsiveProps,
  responsiveMarkupEnabled,
  type ResponsiveProp,
} from "./responsive-media.js";

/**
 * Attach the media library's stored responsive derivatives to the image-bearing
 * blocks before they render (#103).
 *
 * The editor only stores an image's public URL. Here we batch-load the matching
 * `media` rows once per render and clone the tree with a `responsive` prop
 * injected into `core.image` (one prop) and `justflows.gallery.grid` (a URL →
 * prop map). `@justflows/blocks` and `gallery-public.ts` re-sanitize the
 * injected values, so a stale or hand-edited value can only degrade to a plain
 * `<img>`.
 *
 * Runs on cache-miss renders only (public HTML is cached downstream); the Tools
 * regeneration job wipes that cache when it rebuilds variants. Skipped entirely
 * when `JF_IMAGE_RESPONSIVE_MARKUP=0`.
 */

function galleryUrlsOf(props: Record<string, unknown> | undefined): string[] {
  if (!props) return [];
  const out: string[] = [];
  const items = props["items"];
  if (Array.isArray(items)) {
    for (const row of items) {
      const item = (row ?? {}) as Record<string, unknown>;
      const raw = item["src"] ?? item["url"];
      if (isUploadUrl(raw)) out.push(raw);
    }
  }
  const urls = props["urls"] ?? props["items"];
  if (typeof urls === "string") {
    for (const token of urls.split(/\s+/)) {
      if (isUploadUrl(token)) out.push(token);
    }
  }
  return out;
}

function collectUrls(blocks: BlockNode[], into: Set<string>): void {
  for (const block of blocks) {
    if (block.type === "core.image" && isUploadUrl(block.props?.["src"])) {
      into.add(block.props["src"] as string);
    } else if (block.type === GALLERY_BLOCK_TYPE) {
      for (const url of galleryUrlsOf(block.props)) into.add(url);
    }
    if (block.children?.length) collectUrls(block.children, into);
  }
}

function mapTree(blocks: BlockNode[], byUrl: Map<string, ResponsiveProp>): BlockNode[] {
  return blocks.map((block) => {
    const children = block.children?.length ? mapTree(block.children, byUrl) : block.children;
    const withChildren = <T extends BlockNode>(node: T): T =>
      children && children !== block.children ? { ...node, children } : node;

    if (block.type === "core.image" && isUploadUrl(block.props?.["src"])) {
      const prop = byUrl.get(block.props["src"] as string);
      if (prop) return withChildren({ ...block, props: { ...block.props, responsive: prop } });
    } else if (block.type === GALLERY_BLOCK_TYPE) {
      const map: Record<string, ResponsiveProp> = {};
      for (const url of galleryUrlsOf(block.props)) {
        const prop = byUrl.get(url);
        if (prop) map[url] = prop;
      }
      if (Object.keys(map).length > 0) {
        return withChildren({ ...block, props: { ...block.props, responsive: map } });
      }
    }
    return withChildren(block);
  });
}

/**
 * Return the block tree with `responsive` data injected into every `core.image`
 * and gallery block that points at an uploaded file with generated derivatives.
 * The input is returned unchanged when there is nothing to resolve.
 */
export async function withResponsiveImages(
  blocks: BlockNode[],
  siteId: string | null,
): Promise<BlockNode[]> {
  if (!responsiveMarkupEnabled()) return blocks;

  const urls = new Set<string>();
  collectUrls(blocks, urls);
  if (urls.size === 0) return blocks;

  const byUrl = await loadResponsiveProps(urls, siteId);
  if (byUrl.size === 0) return blocks;

  return mapTree(blocks, byUrl);
}
