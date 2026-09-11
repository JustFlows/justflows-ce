// SPDX-License-Identifier: MIT

import { esc, renderResponsiveImage, safeMediaSrc } from "@justflows/blocks";
import { getPlugin } from "./plugins-db.js";
import { getSiteId } from "./themes-db.js";
import { getRuntimeBlockRegistry } from "./runtime-blocks.js";
import { applyResponsiveProp, type ResponsiveProp } from "./responsive-media.js";

export const GALLERY_PLUGIN_ID = "justflows.gallery";
export const GALLERY_BLOCK_TYPE = "justflows.gallery.grid";

export type GalleryLayout = "grid" | "masonry" | "carousel" | "slideshow" | "list";

const GALLERY_LAYOUTS: GalleryLayout[] = ["grid", "masonry", "carousel", "slideshow", "list"];

export interface GalleryItem {
  src: string;
  alt: string;
  caption: string;
  /** Responsive derivatives for `src`, injected by `withResponsiveImages` before render. */
  responsive?: ResponsiveProp;
}

export interface GalleryProps {
  items: GalleryItem[];
  layout: GalleryLayout;
  columns: number;
  lightbox: boolean;
}

function responsiveMapOf(raw: unknown): Record<string, ResponsiveProp> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, ResponsiveProp>)
    : {};
}

/**
 * Normalize a `responsive` value into a `ResponsiveProp` or `undefined`.
 *
 * `renderGalleryHtml` parses its props twice (once as the block's `validateProps`,
 * once internally), so this has to survive a round-trip: the first parse folds
 * the injected URL→prop map into `item.responsive`, and the second parse must
 * carry that through rather than drop it. Block props are also persisted,
 * editable JSON, so the shape is validated here — a malformed value degrades to
 * a plain `<img>` instead of throwing.
 */
function coerceResponsive(raw: unknown): ResponsiveProp | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const sources = Array.isArray(r.sources)
    ? r.sources
        .filter(
          (s): s is { type: string; srcset: string } =>
            !!s &&
            typeof s === "object" &&
            typeof (s as Record<string, unknown>).type === "string" &&
            typeof (s as Record<string, unknown>).srcset === "string",
        )
        .map((s) => ({ type: s.type, srcset: s.srcset }))
    : [];
  const fallbackSrcset = typeof r.fallbackSrcset === "string" ? r.fallbackSrcset : "";
  const src = typeof r.src === "string" ? r.src : "";
  if (!src && sources.length === 0 && !fallbackSrcset) return undefined;
  return {
    src,
    width: Number(r.width) || 0,
    height: Number(r.height) || 0,
    sources,
    fallbackSrcset,
    focalX: r.focalX == null ? null : Number(r.focalX) || null,
    focalY: r.focalY == null ? null : Number(r.focalY) || null,
  };
}

export async function isGalleryPluginEnabled(siteId?: string): Promise<boolean> {
  const id = siteId ?? (await getSiteId());
  if (!id) return false;
  const plugin = await getPlugin(id, GALLERY_PLUGIN_ID);
  return plugin?.status === "active";
}

function parseItems(raw: unknown, responsive: Record<string, ResponsiveProp> = {}): GalleryItem[] {
  if (Array.isArray(raw)) {
    return raw
      .map((row) => {
        const item = (row ?? {}) as Record<string, unknown>;
        const rawSrc = String(item.src ?? item.url ?? "");
        const src = safeMediaSrc(rawSrc);
        if (!src) return null;
        const prop = coerceResponsive(responsive[rawSrc] ?? item.responsive);
        return {
          src,
          alt: String(item.alt ?? "").slice(0, 200),
          caption: String(item.caption ?? "").slice(0, 300),
          ...(prop ? { responsive: prop } : {}),
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
      if (!src) return null;
      const prop = coerceResponsive(responsive[url]);
      return { src, alt: "", caption: "", ...(prop ? { responsive: prop } : {}) };
    })
    .filter((item): item is GalleryItem => Boolean(item));
}

export function parseGalleryProps(raw: unknown): GalleryProps {
  const row = (raw ?? {}) as Record<string, unknown>;
  const items = parseItems(row.items ?? row.urls, responsiveMapOf(row.responsive));
  const layout: GalleryLayout = GALLERY_LAYOUTS.includes(row.layout as GalleryLayout)
    ? (row.layout as GalleryLayout)
    : "grid";
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

/** A layout-aware `sizes` hint for gallery thumbnails. */
function gallerySizes(layout: GalleryLayout, columns: number): string {
  if (layout === "grid" || layout === "masonry") {
    const pct = Math.max(10, Math.round(100 / Math.max(1, columns)));
    return `(max-width: 600px) 100vw, ${pct}vw`;
  }
  if (layout === "list") return "(max-width: 700px) 100vw, 700px";
  return "100vw"; // carousel / slideshow fill the frame
}

/**
 * One gallery image. Uses responsive `<picture>` markup when derivatives were
 * injected for `item.src`; otherwise the plain `<img>` this block has always
 * emitted.
 */
function galleryImg(item: GalleryItem, sizes: string): string {
  if (!item.responsive) {
    return `<img src="${item.src}" alt="${esc(item.alt)}" loading="lazy">`;
  }
  return renderResponsiveImage(
    applyResponsiveProp({ src: item.src, alt: item.alt, loading: "lazy", sizes }, item.responsive),
  );
}

export function renderGalleryHtml(rawProps: unknown): string {
  const props = parseGalleryProps(rawProps);
  if (props.items.length === 0) {
    return `<div class="jf-gallery jf-gallery--empty">Add images to this gallery.</div>`;
  }
  const thumbSizes = gallerySizes(props.layout, props.columns);
  const stamp = itemId(
    `${props.layout}:${props.items.map((item) => item.src).join("|")}`,
    props.columns,
  );
  const galleryId = `jf-gal-${stamp}`;
  const multiple = props.items.length > 1;

  // Each item carries its own id (distinct from the lightbox popup ids below)
  // so carousel/slideshow dots can jump straight to it — scroll-into-view or
  // a CSS `:target` reveal, entirely without client-side script.
  const slides = props.items.map((item, index) => {
    const slideId = `${stamp}-s${index}`;
    const img = galleryImg(item, thumbSizes);
    const caption = item.caption
      ? `<span class="jf-gallery__caption">${esc(item.caption)}</span>`
      : "";
    const inner = `${img}${caption}`;
    const html = props.lightbox
      ? `<a class="jf-gallery__item" id="${slideId}" href="#${stamp}-${index}">${inner}</a>`
      : `<figure class="jf-gallery__item" id="${slideId}">${inner}</figure>`;
    return { slideId, html };
  });
  const allSlides = slides.map((s) => s.html).join("");

  const dots = (className: string) =>
    multiple
      ? `<div class="${className}">${slides
          .map(
            (s, i) =>
              `<a class="jf-gallery__dot" href="#${s.slideId}" aria-label="Go to slide ${i + 1}"></a>`,
          )
          .join("")}</div>`
      : "";

  let body: string;
  switch (props.layout) {
    case "carousel":
      body =
        `<div class="jf-gallery jf-gallery--carousel" id="${galleryId}">` +
        `<div class="jf-carousel__track">${allSlides}</div>` +
        dots("jf-carousel__dots") +
        `</div>`;
      break;
    case "slideshow":
      body =
        `<div class="jf-gallery jf-gallery--slideshow" id="${galleryId}">` +
        `<div class="jf-slideshow__stage">${allSlides}</div>` +
        dots("jf-slideshow__dots") +
        `</div>`;
      break;
    case "list":
      body = `<div class="jf-gallery jf-gallery--list" id="${galleryId}">${allSlides}</div>`;
      break;
    case "masonry":
      body = `<div class="jf-gallery jf-gallery--masonry jf-gallery--cols-${props.columns}" id="${galleryId}">${allSlides}</div>`;
      break;
    default:
      body = `<div class="jf-gallery jf-gallery--grid jf-gallery--cols-${props.columns}" id="${galleryId}">${allSlides}</div>`;
  }

  const lightboxes = props.lightbox
    ? props.items
        .map((item, index) => {
          const id = `${stamp}-${index}`;
          const prevIndex = (index - 1 + props.items.length) % props.items.length;
          const nextIndex = (index + 1) % props.items.length;
          return `<div class="jf-lightbox" id="${id}">
            <a class="jf-lightbox__backdrop" href="#${galleryId}" aria-label="Close"></a>
            <figure class="jf-lightbox__frame">
              ${galleryImg(item, "100vw")}
              ${item.caption ? `<figcaption>${esc(item.caption)}</figcaption>` : ""}
            </figure>
            <a class="jf-lightbox__close" href="#${galleryId}" aria-label="Close">×</a>
            ${multiple ? `<a class="jf-lightbox__prev" href="#${stamp}-${prevIndex}" aria-label="Previous">‹</a><a class="jf-lightbox__next" href="#${stamp}-${nextIndex}" aria-label="Next">›</a>` : ""}
          </div>`;
        })
        .join("")
    : "";

  return `${body}${lightboxes}`;
}

/**
 * The block registry is a process-wide singleton, so a type registered while
 * the plugin was active would otherwise outlive deactivation — still listed in
 * the builder's catalog and still renderable via the generic block path.
 */
export function unregisterGalleryBlock(): void {
  getRuntimeBlockRegistry().unregister(GALLERY_BLOCK_TYPE);
}

export function registerGalleryBlock(): void {
  const registry = getRuntimeBlockRegistry();
  if (registry.get(GALLERY_BLOCK_TYPE)) return;
  registry.register({
    type: GALLERY_BLOCK_TYPE,
    version: 1,
    title: "Gallery",
    description:
      "Responsive image gallery — grid, masonry, carousel, slideshow, or list — with lightbox.",
    icon: "🖼",
    category: "media",
    schema: {
      urls: { type: "textarea" },
      columns: { type: "number", default: 3 },
      layout: { type: "select", options: [...GALLERY_LAYOUTS], default: "grid" },
    },
    validateProps: (raw) => parseGalleryProps(raw) as unknown as Record<string, unknown>,
    render: (props) => renderGalleryHtml(props),
  });
}
