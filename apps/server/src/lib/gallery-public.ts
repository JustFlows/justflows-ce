// SPDX-License-Identifier: MIT

import { esc, safeMediaSrc } from "@justflows/blocks";
import { getPlugin } from "./plugins-db.js";
import { getSiteId } from "./themes-db.js";
import { getRuntimeBlockRegistry } from "./runtime-blocks.js";

export const GALLERY_PLUGIN_ID = "justflows.gallery";
export const GALLERY_BLOCK_TYPE = "justflows.gallery.grid";

export type GalleryLayout = "grid" | "masonry";

export interface GalleryItem {
  src: string;
  alt: string;
  caption: string;
}

export interface GalleryProps {
  items: GalleryItem[];
  layout: GalleryLayout;
  columns: number;
  lightbox: boolean;
}

export async function isGalleryPluginEnabled(siteId?: string): Promise<boolean> {
  const id = siteId ?? (await getSiteId());
  if (!id) return false;
  const plugin = await getPlugin(id, GALLERY_PLUGIN_ID);
  return Boolean(plugin && plugin.status !== "inactive" && plugin.status !== "error");
}

function parseItems(raw: unknown): GalleryItem[] {
  if (Array.isArray(raw)) {
    return raw
      .map((row) => {
        const item = (row ?? {}) as Record<string, unknown>;
        const src = safeMediaSrc(String(item.src ?? item.url ?? ""));
        if (!src) return null;
        return {
          src,
          alt: String(item.alt ?? "").slice(0, 200),
          caption: String(item.caption ?? "").slice(0, 300),
        };
      })
      .filter((item): item is GalleryItem => Boolean(item));
  }
  return String(raw ?? "")
    .split(/\s+/)
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => {
      const src = safeMediaSrc(url);
      return src ? { src, alt: "", caption: "" } : null;
    })
    .filter((item): item is GalleryItem => Boolean(item));
}

export function parseGalleryProps(raw: unknown): GalleryProps {
  const row = (raw ?? {}) as Record<string, unknown>;
  const items = parseItems(row.items ?? row.urls);
  const layout: GalleryLayout = row.layout === "masonry" ? "masonry" : "grid";
  const columns = Math.min(6, Math.max(2, Number(row.columns) || 3));
  return {
    items,
    layout,
    columns,
    lightbox: row.lightbox !== false && row.lightbox !== "false",
  };
}

function itemId(src: string, index: number): string {
  let hash = 0;
  const seed = `${index}:${src}`;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return `jf-lb-${(hash >>> 0).toString(36)}-${index}`;
}

export function renderGalleryHtml(rawProps: unknown): string {
  const props = parseGalleryProps(rawProps);
  if (props.items.length === 0) {
    return `<div class="jf-gallery jf-gallery--empty">Add images to this gallery.</div>`;
  }
  const stamp = itemId(`${props.layout}:${props.items.map((item) => item.src).join("|")}`, props.columns);
  const galleryId = `jf-gal-${stamp}`;
  const layoutClass = props.layout === "masonry" ? "jf-gallery--masonry" : "jf-gallery--grid";
  const thumbs = props.items
    .map((item, index) => {
      const img = `<img src="${item.src}" alt="${esc(item.alt)}" loading="lazy">`;
      const caption = item.caption ? `<span class="jf-gallery__caption">${esc(item.caption)}</span>` : "";
      if (!props.lightbox) {
        return `<figure class="jf-gallery__item">${img}${caption}</figure>`;
      }
      return `<a class="jf-gallery__item" href="#${stamp}-${index}">${img}${caption}</a>`;
    })
    .join("");

  const lightboxes = props.lightbox
    ? props.items
        .map((item, index) => {
          const id = `${stamp}-${index}`;
          const prevIndex = (index - 1 + props.items.length) % props.items.length;
          const nextIndex = (index + 1) % props.items.length;
          return `<div class="jf-lightbox" id="${id}">
            <a class="jf-lightbox__backdrop" href="#${galleryId}" aria-label="Close"></a>
            <figure class="jf-lightbox__frame">
              <img src="${item.src}" alt="${esc(item.alt)}">
              ${item.caption ? `<figcaption>${esc(item.caption)}</figcaption>` : ""}
            </figure>
            <a class="jf-lightbox__close" href="#${galleryId}" aria-label="Close">×</a>
            ${props.items.length > 1 ? `<a class="jf-lightbox__prev" href="#${stamp}-${prevIndex}" aria-label="Previous">‹</a><a class="jf-lightbox__next" href="#${stamp}-${nextIndex}" aria-label="Next">›</a>` : ""}
          </div>`;
        })
        .join("")
    : "";

  return `<div class="jf-gallery ${layoutClass} jf-gallery--cols-${props.columns}" id="${galleryId}">${thumbs}</div>${lightboxes}`;
}

export function registerGalleryBlock(): void {
  const registry = getRuntimeBlockRegistry();
  if (registry.get(GALLERY_BLOCK_TYPE)) return;
  registry.register({
    type: GALLERY_BLOCK_TYPE,
    version: 1,
    title: "Gallery",
    description: "Responsive image gallery with grid or masonry layout and lightbox.",
    icon: "🖼",
    category: "media",
    schema: {
      urls: { type: "textarea" },
      columns: { type: "number", default: 3 },
      layout: { type: "select", options: ["grid", "masonry"], default: "grid" },
    },
    validateProps: (raw) => parseGalleryProps(raw) as unknown as Record<string, unknown>,
    render: (props) => renderGalleryHtml(props),
  });
}
