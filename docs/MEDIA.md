# Media and responsive images

The media library stores the original of every upload. For raster images it also
generates a set of **responsive derivatives** — width-scaled copies plus modern
formats — and the public renderer emits `<picture>` / `srcset` markup so a page
ships an image sized to the layout instead of the full-resolution original.

This is one of the largest performance wins available: no oversized images, no
layout shift, and WebP/AVIF where the browser supports them.

---

## What happens on upload

For a JPEG, PNG, WebP, AVIF, or GIF upload:

1. The original is stored unchanged under `uploads/<siteId>/<uuid>.<ext>`.
2. `@justflows/media` builds, from the original bytes:
   - one **width-scaled variant per configured width** (never upscaled, capped at
     `JF_IMAGE_MAX_WIDTH`), in a fallback format — JPEG, or PNG when the source
     has an alpha channel;
   - the same widths again in each **modern format** (`webp`, and `avif` when
     enabled);
   - one **focal-point square thumbnail** for the library and small UI.
3. Variants are written next to the original under
   `uploads/<siteId>/<mediaId>/<width>.<ext>`, and the set is recorded on the
   `media` row (`derivatives` JSON, plus `width`, `height`, `original_format`,
   `variants_generated_at`).

EXIF/GPS and other metadata are **stripped** from every generated variant by
default (`JF_IMAGE_STRIP_METADATA=1`); EXIF orientation is baked in first so a
stripped variant is never sideways. The original keeps its own metadata.

Generation is best-effort: if it fails, the upload still succeeds with the
original only, and **Regenerate** (below) can backfill it later.

### Not processed

- **SVG** is never rasterised. (SVGs are sanitised on upload by the media
  library and served as-is.)
- **Icons, PDF, video, audio** are stored as-is.
- Filenames matching **`JF_IMAGE_KEEP_ORIGINAL`** globs (e.g. `logo*`, `*.png`)
  are stored as-is — for logos, pixel art, and transparency edge cases.
- Nothing happens when `JF_IMAGE_DERIVATIVES=0`.

---

## Configuration

**Admin → Tools → Responsive images** writes these back to `.env` and applies
them immediately — no restart. New uploads and the next regeneration run pick up
the change.

| Variable                     | Default                 | Purpose                                                             |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------- |
| `JF_IMAGE_DERIVATIVES`       | `1`                     | Master switch for generation. `0` stores originals only.            |
| `JF_IMAGE_RESPONSIVE_MARKUP` | `1`                     | Emit `<picture>`/`srcset` on the public site. `0` serves originals. |
| `JF_IMAGE_WIDTHS`            | `320,640,960,1280,1920` | Variant widths in px. Widths ≥ the source width are skipped.        |
| `JF_IMAGE_MAX_WIDTH`         | `2560`                  | Cap on the largest generated width.                                 |
| `JF_IMAGE_FORMATS`           | `webp`                  | Modern formats. `webp,avif` also emits AVIF (slower encode).        |
| `JF_IMAGE_QUALITY_WEBP`      | `82`                    | WebP encoder quality (1–100).                                       |
| `JF_IMAGE_QUALITY_AVIF`      | `50`                    | AVIF encoder quality (1–100).                                       |
| `JF_IMAGE_QUALITY_JPEG`      | `82`                    | JPEG fallback quality (1–100).                                      |
| `JF_IMAGE_STRIP_METADATA`    | `1`                     | Strip EXIF/GPS from generated variants.                             |
| `JF_IMAGE_THUMB`             | `400x400`               | Focal-point square thumbnail size, or `off`.                        |
| `JF_IMAGE_KEEP_ORIGINAL`     | —                       | Comma-separated filename globs to store untouched.                  |

AVIF is **off by default**: it produces the smallest files but is
CPU-heavy to encode (roughly 1–3 s per image on shared hosting). Turn it on when
your host can afford it.

---

## Focal point

Each image has a focal point (0–1 on each axis, centre by default). It controls
where art-directed crops keep the subject:

- the generated square **thumbnail** is cropped around it;
- image blocks rendered with `object-fit: cover` get a matching
  `object-position`.

Set it in **Media Library → click an image → click the subject on the preview**.
Saving a new focal point rebuilds that one image's variants.

---

## Rendered markup

`core.image` (and any block using `renderResponsiveImage` from
`@justflows/blocks`) emits, when derivatives exist:

```html
<picture>
  <source type="image/avif" srcset="…-640.avif 640w, …-1280.avif 1280w" sizes="…" />
  <source type="image/webp" srcset="…-640.webp 640w, …-1280.webp 1280w" sizes="…" />
  <img
    src="…-1280.jpg"
    srcset="…-640.jpg 640w, …-1280.jpg 1280w"
    sizes="…"
    width="1600"
    height="900"
    loading="lazy"
    decoding="async"
  />
</picture>
```

- **Intrinsic `width`/`height`** are always set when known, so the browser
  reserves space and the page does not shift as images load.
- **`loading="lazy"` and `decoding="async"`** are the defaults. For an
  above-the-fold image set the block's **Loading** field to `eager` — it drops
  lazy loading and adds `fetchpriority="high"`.
- The **`sizes`** attribute defaults to `100vw`; set the block's **Sizes** field
  to something layout-aware such as `(max-width: 800px) 100vw, 800px`.

The server resolves derivatives on cache-miss renders only; the resolved values
are re-sanitised in `packages/blocks`, so a stale or hand-edited value can only
degrade to a plain `<img>`.

### Where it applies

Every public surface that renders an uploaded image goes through the same
resolver ([`responsive-media.ts`](../apps/server/src/lib/responsive-media.ts)):

- **`core.image`** blocks;
- the **Gallery** block (`justflows.gallery.grid`) — grid, masonry, carousel,
  slideshow, list, and the lightbox, each with a layout-aware `sizes`;
- **blog-post-list** featured-image thumbnails;
- the **Featured Image** theme-template block (`core.featured-image`).

Plugin and theme blocks get the same treatment by calling `renderMediaImage()`
(async, one URL) or `loadResponsiveProps()` + `renderResponsiveImage()` (a batch,
for many images) instead of writing their own `<img>` tag.

Not converted: the site logo and nav icons (small brand assets — use
`JF_IMAGE_KEEP_ORIGINAL`), CSS `background-image` (e.g. `core.hero`), HTML email,
and social `og:image` meta tags.

Setting **`JF_IMAGE_RESPONSIVE_MARKUP=0`** makes all of the above emit a plain
`<img src>` pointing at the original — the generated files stay on disk, so you
can flip it back on without regenerating.

---

## Regeneration

**Admin → Tools → Responsive images → Regenerate all images**, or the
**Regenerate responsive images** button in the Media Library.

Walks every non-trashed image in the site, rebuilds its variant set with the
current configuration, updates the row, and clears the page cache so the next
request re-renders with the new `srcset`. Run it after changing widths, formats,
or quality. Progress and per-file failures are shown while it runs.

`POST /api/media/regenerate` starts it (administrators only, rate-limited);
`GET /api/media/regenerate/status` returns progress. One run per process at a
time.

---

## Storage and CDN

Variants live under the same `uploads/` path as originals
(`STORAGE_LOCAL_PATH`), in a per-image folder. Any setup that offloads or
fronts `/uploads` with a CDN or S3-compatible bucket serves the variants from
the same path with no extra configuration. The static export
(`docs/STATIC-EXPORT.md`) already follows `srcset` and `<source>` URLs, so
exported pages copy every referenced variant.

Trashing an image moves its variant folder to `uploads/.trash/` alongside the
original; restoring moves it back; purging deletes it.
