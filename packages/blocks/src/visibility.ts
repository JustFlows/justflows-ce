// SPDX-License-Identifier: MIT

/**
 * Per-element device visibility — the shared primitive behind the block
 * builder's "Show on devices" control and the menu designer's identical one.
 *
 * Presentation only: the element stays in the HTML and is hidden with CSS when
 * the viewport is outside the chosen buckets. Stored as `props.devices`, an
 * array holding a *proper* subset of the three buckets; a full or empty set
 * means "show everywhere" and is not stored.
 */

export const DEVICE_BUCKETS = ["desktop", "tablet", "mobile"] as const;
export type DeviceBucket = (typeof DEVICE_BUCKETS)[number];

/** Fixed breakpoints for the buckets. Independent of any menu's collapse point. */
export const DEVICE_MAX_MOBILE = 600;
export const DEVICE_MAX_TABLET = 1024;

/**
 * Normalise a stored/inbound value to a canonical-ordered, de-duplicated list —
 * or `null` when it is empty, invalid, or the full set (all meaning "no
 * restriction, don't store anything").
 */
export function normalizeDeviceList(value: unknown): DeviceBucket[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<DeviceBucket>();
  for (const raw of value) {
    if (typeof raw === "string" && (DEVICE_BUCKETS as readonly string[]).includes(raw)) {
      seen.add(raw as DeviceBucket);
    }
  }
  if (seen.size === 0 || seen.size === DEVICE_BUCKETS.length) return null;
  return DEVICE_BUCKETS.filter((b) => seen.has(b));
}

/** `data-jf-devices="…"` attribute string for a value, or `""` when unrestricted. */
export function deviceVisibilityAttr(value: unknown): string {
  const list = normalizeDeviceList(value);
  return list ? `data-jf-devices="${list.join(" ")}"` : "";
}

/**
 * The platform stylesheet that makes `data-jf-devices` do something. Emitted
 * once per page as part of `/theme.css` (see `assembleThemeCss`), so it works
 * on every theme and for every element that carries the attribute — blocks,
 * menu items, header components.
 */
export const BLOCK_VISIBILITY_CSS = `/* Per-element device visibility (data-jf-devices) */
@media (max-width: ${DEVICE_MAX_MOBILE}px) {
  [data-jf-devices]:not([data-jf-devices~="mobile"]) { display: none !important; }
}
@media (min-width: ${DEVICE_MAX_MOBILE + 1}px) and (max-width: ${DEVICE_MAX_TABLET}px) {
  [data-jf-devices]:not([data-jf-devices~="tablet"]) { display: none !important; }
}
@media (min-width: ${DEVICE_MAX_TABLET + 1}px) {
  [data-jf-devices]:not([data-jf-devices~="desktop"]) { display: none !important; }
}
`;

export function blockVisibilityCss(): string {
  return BLOCK_VISIBILITY_CSS;
}
