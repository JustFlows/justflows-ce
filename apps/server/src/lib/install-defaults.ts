// SPDX-License-Identifier: MIT

import {
  DEFAULT_CONTENT_LOCALE,
  metaForCode,
  normalizeLocale,
  type LanguageMeta,
} from "./i18n/locales.js";

/** INSERT used during install. `key` is reserved on MySQL/MariaDB. */
export function siteSettingsInsertSql(driver: "postgres" | "mysql" | "mariadb"): string {
  const keyCol = driver === "postgres" ? "key" : "`key`";
  return `INSERT INTO site_settings (id, site_id, ${keyCol}, value, updated_at) VALUES (?, ?, ?, ?, ?)`;
}

/** Site settings written on a fresh install. */

export function freshInstallSiteSettings(adminEmail: string): [string, unknown][] {
  return [
    ["active_theme", "justflows.default"],
    ["posts_per_page", 10],
    ["timezone", "UTC"],
    ["site_public", false],
    ["discourage_search_engines", true],
    ["admin_email", adminEmail],
    ["users_can_register", false],
    ["default_role", "subscriber"],
    ["date_format", "F j, Y"],
    ["time_format", "g:i a"],
    ["start_of_week", 1],
  ];
}

export function parseInstallLocale(
  input: string | undefined,
): { ok: true; meta: LanguageMeta } | { ok: false; error: string } {
  const raw = input?.trim();
  if (!raw) {
    return { ok: true, meta: metaForCode(DEFAULT_CONTENT_LOCALE) };
  }
  const normalized = normalizeLocale(raw);
  if (!normalized) {
    return { ok: false, error: "Enter a valid language code such as en-US or nl-NL." };
  }
  return { ok: true, meta: metaForCode(normalized) };
}
