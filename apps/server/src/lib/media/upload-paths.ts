// SPDX-License-Identifier: MIT

import { isSafeUploadKey } from "./upload-store.js";

/**
 * Key layout for site uploads, shared by the local folder and S3. Everything a
 * site owns lives under its own `<siteId>/` prefix, so a site can be backed
 * up, moved, or removed as one folder (or one bucket prefix):
 *
 *   <siteId>/<file>                    live original
 *   <siteId>/<mediaId>/                responsive variants
 *   <siteId>/.trash/<file>             trashed original
 *   <siteId>/.trash/<mediaId>/         trashed variants
 *
 * Storage keys are `<siteId>/<file>`. Trash used to be one shared
 * `.trash/<storageKey>` folder; the `legacy*` keys keep items trashed before
 * the move restorable and deletable.
 */

const TRASH = ".trash";

const safe = (key: string): string | null => (isSafeUploadKey(key) ? key : null);

/** Live key for a storage key, or null when it is unsafe. */
export function liveUploadKey(storageKey: string): string | null {
  return safe(storageKey);
}

/** Trashed copy inside the owning site's folder. */
export function trashedUploadKey(storageKey: string): string | null {
  const slash = storageKey.indexOf("/");
  // A key without a site prefix has no site folder; keep it in the shared trash.
  if (slash <= 0) return legacyTrashedUploadKey(storageKey);
  return safe(`${storageKey.slice(0, slash)}/${TRASH}/${storageKey.slice(slash + 1)}`);
}

/** Trashed copy in the pre-per-site shared trash. */
export function legacyTrashedUploadKey(storageKey: string): string | null {
  return safe(`${TRASH}/${storageKey}`);
}

/** Every place a trashed copy may be, current layout first. */
export function trashedUploadKeyCandidates(storageKey: string): string[] {
  const keys = [trashedUploadKey(storageKey), legacyTrashedUploadKey(storageKey)];
  return [...new Set(keys.filter((k): k is string => k !== null))];
}

/** Variant folder (ending in "/") for a media item, live or trashed. */
export function variantPrefix(siteId: string, mediaId: string, trashed: boolean): string | null {
  return safe(trashed ? `${siteId}/${TRASH}/${mediaId}/` : `${siteId}/${mediaId}/`);
}

/** Trashed variant folder in the pre-per-site shared trash. */
export function legacyTrashedVariantPrefix(siteId: string, mediaId: string): string | null {
  return safe(`${TRASH}/${siteId}/${mediaId}/`);
}
