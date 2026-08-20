/**
 * License validation for Justflows plugins and themes.
 *
 * Core is MIT. Extensions declare their own license. Official Marketplace
 * listings must use a GPL-compatible SPDX identifier when distributed.
 */

/** SPDX identifiers and common aliases accepted for marketplace distribution. */
const GPL_COMPATIBLE_IDENTIFIERS = new Set([
  "GPL-2.0",
  "GPL-2.0+",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0",
  "GPL-3.0+",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "LGPL-2.1",
  "LGPL-2.1+",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0",
  "LGPL-3.0+",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
]);

const BLOCKED_PATTERN =
  /\b(proprietary|commercial|unlicensed|all rights reserved|closed source|closed-source)\b/i;

/**
 * Returns true when `license` is a GPL-compatible SPDX identifier (or alias).
 * Compound expressions must only contain compatible identifiers joined by OR.
 */
export function isGplCompatibleLicense(license: string | undefined): boolean {
  if (!license?.trim()) return false;

  const value = license.trim();
  if (BLOCKED_PATTERN.test(value)) return false;

  const parts = value.split(/\s+OR\s+/i).map((part) => normalizeLicenseToken(part));
  if (parts.length === 0) return false;

  return parts.every((part) => GPL_COMPATIBLE_IDENTIFIERS.has(part));
}

/** Human-readable error for manifest validation. */
export function gplLicenseValidationMessage(license: string | undefined): string {
  if (!license?.trim()) {
    return "Manifest must declare a GPL-compatible license (e.g. GPL-2.0-or-later)";
  }
  if (BLOCKED_PATTERN.test(license)) {
    return `License "${license}" is not GPL-compatible. Proprietary extensions cannot be distributed for Justflows.`;
  }
  return `License "${license}" is not recognized as GPL-compatible. Use GPL-2.0-or-later or another GPL-compatible SPDX identifier.`;
}

function normalizeLicenseToken(token: string): string {
  return token
    .trim()
    .replace(/[()]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-only-only$/i, "-only")
    .replace(/^GNU-/i, "");
}
