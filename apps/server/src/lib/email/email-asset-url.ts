// SPDX-License-Identifier: MIT

import { getControlDb } from "../database/db.js";
import { getTenantContext } from "../tenancy/context.js";
import { siteOrigin } from "../rendering/site-origin.js";

/**
 * Email logos as full addresses (justflows-ce#317).
 *
 * The media library stores site-relative addresses (`/uploads/…`). A browser
 * resolves those against the page, but an email client has no page, so a
 * relative logo never loads in sent mail. Before a mail is sent, a library
 * address becomes a full address on the site's primary domain. External
 * HTTPS addresses are kept; anything else is dropped.
 */

const LOOPBACK = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$|\.localhost(?::\d+)?$/;

function originFor(hostname: string): string | null {
  const host = hostname.trim().toLowerCase();
  if (!host || /[\s/\\@]/.test(host)) return null;
  return `${LOOPBACK.test(host) ? "http" : "https"}://${host}`;
}

/**
 * The origin sent mail should load the site's files from: its primary
 * domain, else the address of the current request for that site, else
 * `APP_URL`. Null when none is known.
 */
export async function emailSiteOrigin(siteId: string): Promise<string | null> {
  try {
    const db = await getControlDb();
    const rows = await db.query<{ hostname: string }>(
      "SELECT hostname FROM site_domains WHERE site_id = ? AND is_primary = ? AND status = 'active' ORDER BY created_at ASC LIMIT 1",
      [siteId, true],
    );
    const primary = rows[0] ? originFor(String(rows[0].hostname)) : null;
    if (primary) return primary;
  } catch {
    /** Single-site installs without the domain tables fall through to the request or APP_URL. */
  }
  const context = getTenantContext();
  const fallback = context && context.siteId === siteId ? siteOrigin() : (process.env.APP_URL ?? "").replace(/\/+$/, "");
  return /^https?:\/\/[^/\s]+$/i.test(fallback) ? fallback : null;
}

/**
 * A logo address an email client can load: `/uploads/…` on `origin`, an
 * external `https://` address as it is, and an empty string for anything
 * else (other schemes, protocol-relative or other site paths).
 */
export function absoluteEmailAssetUrl(value: string, origin: string | null): string {
  const url = value.trim();
  if (!url) return "";
  if (url.startsWith("/uploads/") && !url.includes("..") && !url.includes("\\")) return origin ? `${origin}${url}` : "";
  if (/^https:\/\//i.test(url)) {
    try {
      return new URL(url).protocol === "https:" ? url : "";
    } catch {
      return "";
    }
  }
  return "";
}

/** The design with both logos as addresses sent mail can load. */
export function withAbsoluteLogos<T extends { logoUrl: string; darkLogoUrl: string }>(design: T, origin: string | null): T {
  return {
    ...design,
    logoUrl: absoluteEmailAssetUrl(design.logoUrl, origin),
    darkLogoUrl: absoluteEmailAssetUrl(design.darkLogoUrl, origin),
  };
}
