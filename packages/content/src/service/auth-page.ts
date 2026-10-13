// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";

/**
 * The member auth pages. Each is served at the fixed public path `/<slug>` and
 * renders inside the active theme; the admin has its own, unthemed copies under
 * the admin path.
 */
export const AUTH_PAGES = [
  { slug: "login", title: "Sign in", intro: "Sign in to your account." },
  { slug: "register", title: "Create an account", intro: "Create an account to get started." },
  { slug: "forgot-password", title: "Forgot your password?", intro: "Enter your email address and we will send you a link to choose a new password." },
  { slug: "reset-password", title: "Choose a new password", intro: "Enter a new password for your account." },
] as const;

export type AuthPageSlug = (typeof AUTH_PAGES)[number]["slug"];
export const AUTH_PAGE_SLUGS: readonly AuthPageSlug[] = AUTH_PAGES.map((page) => page.slug);

export function defaultAuthBlocks(slug: AuthPageSlug) {
  const page = AUTH_PAGES.find((candidate) => candidate.slug === slug)!;
  return { version: 1, blocks: [
    { id: `auth-${slug}-heading`, type: "core.heading", version: 1, props: { text: page.title, level: 1 } },
    { id: `auth-${slug}-intro`, type: "core.paragraph", version: 1, props: { text: page.intro } },
    { id: `auth-${slug}-form`, type: "core.auth-form", version: 1, props: { form: slug, showLinks: true } },
  ] };
}

/** The editor's starting canvas for a new `auth` page. */
export const DEFAULT_AUTH_BLOCKS = defaultAuthBlocks("login");

interface AuthPageDb {
  query<T>(sql: string, params: string[]): Promise<T[]>;
  run(sql: string, params: string[]): Promise<unknown>;
}

/**
 * Idempotent install/backfill seed, one page per slug. Never replaces a page
 * that exists under that slug in any state — customized, draft or trashed.
 */
export async function seedAuthPages(db: AuthPageDb, siteId: string, locale: string): Promise<void> {
  const existing = await db.query<{ slug: string }>("SELECT slug FROM content WHERE site_id = ? AND type = 'auth'", [siteId]);
  const have = new Set(existing.map((row) => row.slug));
  const stamp = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  for (const page of AUTH_PAGES) {
    if (have.has(page.slug)) continue;
    try {
      await db.run(`INSERT INTO content (id, site_id, type, status, slug, title, blocks, fields, locale, created_at, updated_at, published_at)
        VALUES (?, ?, 'auth', 'published', ?, ?, ?, '{}', ?, ?, ?, ?)`,
        [randomUUID(), siteId, page.slug, page.title, JSON.stringify(defaultAuthBlocks(page.slug)), locale, stamp, stamp, stamp]);
    } catch (error) {
      // A concurrent installer may have won the unique (site, type, slug, locale) key.
      if (!/unique|duplicate/i.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  }
}
