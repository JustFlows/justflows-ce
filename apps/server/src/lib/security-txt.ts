// SPDX-License-Identifier: MIT

import { siteOrigin } from "./seo-public.js";

/**
 * RFC 9116 security.txt.
 *
 * Three things the previous version got wrong, all of which make a scanner
 * treat the file as invalid rather than merely imperfect:
 *
 *  - `Expires` is REQUIRED (§2.5.5) and was absent. It exists so a stale file
 *    stops being trusted rather than pointing researchers at an address nobody
 *    reads any more.
 *  - `Canonical` MUST be a URI (§2.5.2); a bare path is not one.
 *  - `Policy` named a different repository from the one being served.
 */

/** How far ahead Expires is set. RFC 9116 §2.5.5 recommends under a year. */
const EXPIRY_DAYS = 180;

export function securityTxtExpiry(from = new Date()): string {
  const expires = new Date(from.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  // Whole seconds: fractional seconds are legal ISO 8601 but noise here.
  return `${expires.toISOString().replace(/\.\d{3}Z$/, "Z")}`;
}

/**
 * Build the file for a given origin.
 *
 * Computed per request rather than at module load so `Expires` cannot go stale
 * on a long-lived process — a server up for eight months would otherwise be
 * serving an expired file.
 */
export function buildSecurityTxt(origin: string, now = new Date()): string {
  const base = origin.replace(/\/$/, "");
  const lines = [
    "# Justflows — how to report a security issue.",
    "# https://www.rfc-editor.org/rfc/rfc9116",
    "",
    "Contact: mailto:security@justflows.com",
    `Expires: ${securityTxtExpiry(now)}`,
    "Preferred-Languages: en",
  ];

  // Canonical and Policy must be absolute. Without a configured APP_URL we
  // cannot know the origin, and a wrong absolute URI is worse than an absent
  // optional field — so both are omitted rather than guessed.
  if (base) {
    lines.push(`Canonical: ${base}/.well-known/security.txt`);
  }
  lines.push(
    "Policy: https://github.com/JustFlows/justflows-ce/blob/main/SECURITY.md",
    "",
  );
  return lines.join("\n");
}

/** Resolve the origin from APP_URL, or "" when it is unusable. */
export function securityTxtOrigin(): string {
  try {
    return siteOrigin();
  } catch {
    return "";
  }
}
