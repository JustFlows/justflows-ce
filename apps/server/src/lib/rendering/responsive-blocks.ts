// SPDX-License-Identifier: MIT

import type { BlockNode } from "../runtime/types.js";
import { getRuntimeBlockRegistry } from "./runtime-blocks.js";
import {
  isUploadUrl,
  loadResponsiveProps,
  responsiveMarkupEnabled,
  type ResponsiveProp,
} from "../media/responsive-media.js";
import { resolvePlaceholderSync } from "../media/placeholders.js";

/**
 * Attach the media library's stored responsive derivatives to the image-bearing
 * blocks before they render (#103).
 *
 * The editor only stores an image's public URL. Here we batch-load the matching
 * `media` rows once per render and clone the tree with a `responsive` prop
 * injected into `core.image` (one prop) and into any other registered block
 * whose schema has `media` or `images` fields (a URL → prop map). The block's
 * own render re-sanitizes the injected values (the SDK's
 * `renderResponsiveImage`), so a stale or hand-edited value can only degrade
 * to a plain `<img>`.
 *
 * Runs on cache-miss renders only (public HTML is cached downstream); the Tools
 * regeneration job wipes that cache when it rebuilds variants. Skipped entirely
 * when `JF_IMAGE_RESPONSIVE_MARKUP=0`.
 */

/** Uploaded image URLs in a registered block's `media` and `images` fields. Empty for unknown types. */
function imageFieldUrlsOf(type: string, props: Record<string, unknown> | undefined): string[] {
  if (!props || type === "core.image") return [];
  const schema = getRuntimeBlockRegistry().get(type)?.schema;
  if (!schema) return [];
  const out: string[] = [];
  for (const [name, field] of Object.entries(schema)) {
    const value = props[name];
    if (field.type === "media" && isUploadUrl(value)) out.push(value);
    if (field.type === "images" && Array.isArray(value)) {
      for (const row of value) {
        const raw = ((row ?? {}) as Record<string, unknown>)["src"];
        if (isUploadUrl(raw)) out.push(raw);
      }
    }
  }
  return out;
}

function collectUrls(blocks: BlockNode[], into: Set<string>): void {
  for (const block of blocks) {
    if (block.type === "core.image" && isUploadUrl(block.props?.["src"])) {
      into.add(block.props["src"] as string);
    } else {
      for (const url of imageFieldUrlsOf(block.type, block.props)) into.add(url);
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
    } else {
      const map: Record<string, ResponsiveProp> = {};
      for (const url of imageFieldUrlsOf(block.type, block.props)) {
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
 * and every block with image fields that points at an uploaded file with
 * generated derivatives.
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

function hasEmptyImage(blocks: BlockNode[]): boolean {
  return blocks.some(
    (block) =>
      (block.type === "core.image" && !String(block.props?.["src"] ?? "").trim()) ||
      (block.children?.length ? hasEmptyImage(block.children) : false),
  );
}

function fillEmptyImages(blocks: BlockNode[], src: string): BlockNode[] {
  return blocks.map((block) => {
    const children = block.children?.length ? fillEmptyImages(block.children, src) : block.children;
    const next = children !== block.children ? { ...block, children } : block;
    if (block.type === "core.image" && !String(block.props?.["src"] ?? "").trim()) {
      return { ...next, props: { ...block.props, src, alt: "" } };
    }
    return next;
  });
}

/**
 * Point every `core.image` that has no image at the site's `generic`
 * placeholder. Unchanged when placeholders are off. Call after
 * `primePlaceholders` so the site's own placeholder applies.
 */
export function withImagePlaceholders(blocks: BlockNode[], siteId: string | null): BlockNode[] {
  if (!siteId || !hasEmptyImage(blocks)) return blocks;
  const image = resolvePlaceholderSync(siteId, "generic");
  return image ? fillEmptyImages(blocks, image.src) : blocks;
}
