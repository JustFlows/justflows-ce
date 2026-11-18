// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";

export const DEFAULT_ACCOUNT_BLOCKS = { version: 1, blocks: [
  { id: "account-heading", type: "core.heading", version: 1, props: { text: "Your account", level: 1 } },
  { id: "account-intro", type: "core.paragraph", version: 1, props: { text: "Your details and services in one place." } },
  ...["controls", "profile", "plugins", "workspaces"].map(section => ({ id: `account-${section}`, type: "core.account", version: 1, props: { section, sectionId: "", showTitles: true } })),
] };

/** The member's own data page, served at `/account-data`. */
export const ACCOUNT_DATA_SLUG = "account-data";

export const DEFAULT_ACCOUNT_DATA_BLOCKS = { version: 1, blocks: [
  { id: "account-data-heading", type: "core.heading", version: 1, props: { text: "Your data", level: 1 } },
  { id: "account-data-intro", type: "core.paragraph", version: 1, props: { text: "See what this site keeps about you, download a copy, or ask us to remove it." } },
  { id: "account-data-panel", type: "core.account-data", version: 1, props: { showSummary: true, showDownload: true, showRemoval: true } },
] };

interface AccountPageDb {
  query<T>(sql: string, params: string[]): Promise<T[]>;
  run(sql: string, params: string[]): Promise<unknown>;
}

const stampOf = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");

async function insertPage(db: AccountPageDb, siteId: string, locale: string, slug: string, title: string, blocks: object, stamp: string): Promise<void> {
  try {
    await db.run(`INSERT INTO content (id, site_id, type, status, slug, title, blocks, fields, locale, created_at, updated_at, published_at)
      VALUES (?, ?, 'account', 'published', ?, ?, ?, '{}', ?, ?, ?, ?)`,
      [randomUUID(), siteId, slug, title, JSON.stringify(blocks), locale, stamp, stamp, stamp]);
  } catch (error) {
    // A concurrent installer may have won the unique (site, type, slug, locale) key.
    if (!/unique|duplicate/i.test(error instanceof Error ? error.message : String(error))) throw error;
  }
}

/**
 * Idempotent install/backfill seed of the account pages: "Your account" and
 * "Your data". Never replaces a customized, renamed, draft or trashed page.
 * "Your data" is left out when anything on the site already uses its address.
 */
export async function seedAccountPage(db: AccountPageDb, siteId: string, locale: string): Promise<void> {
  const rows = await db.query<{ type: string; slug: string }>(
    "SELECT type, slug FROM content WHERE site_id = ? AND (type = 'account' OR slug = ?)", [siteId, ACCOUNT_DATA_SLUG]);
  const now = Date.now();
  if (!rows.some(row => row.type === "account")) {
    await insertPage(db, siteId, locale, "account", "Your account", DEFAULT_ACCOUNT_BLOCKS, stampOf(now));
  }
  if (!rows.some(row => row.slug === ACCOUNT_DATA_SLUG)) {
    /** A second later, so "Your account" stays the first account page and keeps `/account`. */
    await insertPage(db, siteId, locale, ACCOUNT_DATA_SLUG, "Your data", DEFAULT_ACCOUNT_DATA_BLOCKS, stampOf(now + 1000));
  }
}
