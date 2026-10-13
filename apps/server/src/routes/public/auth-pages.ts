// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from "express";
import type { AuthPageSlug } from "@justflows/content";
import { getDb } from "../../lib/database/db.js";
import { serializeContentRow } from "../../lib/content/content-api.js";
import { getSiteId } from "../../lib/settings/site-settings.js";
import { getDefaultLocale } from "../../lib/i18n/languages-db.js";
import { privateAccountResponse } from "../../middleware/account-cache.js";
import { securityHeaders } from "../../middleware/security-headers.js";
import { withoutSharedCache } from "../../lib/cache/jf-cache.js";
import { isPreviewAllowed } from "../../lib/auth/auth-session.js";

/**
 * The member auth pages (`/login`, `/register`, `/forgot-password`,
 * `/reset-password`), rendered inside the active theme from the site's `auth`
 * pages. They are the site surface only: the API refuses staff accounts here,
 * and nothing on them links to or names the admin, whose own pages live under
 * the admin path. `next()` falls through to the bare form when no page exists.
 */
export async function serveAuthPage(slug: AuthPageSlug, req: Request, res: Response, next: NextFunction): Promise<void> {
  const siteId = await getSiteId();
  if (!siteId) { next(); return; }
  const preview = await isPreviewAllowed(req, res);
  const db = await getDb();
  const load = () => db.query<Record<string, unknown>>(
    `SELECT * FROM content WHERE site_id = ? AND type = 'auth' AND slug = ? AND trashed_at IS NULL${preview ? "" : " AND status = 'published'"}`,
    [siteId, slug],
  );
  let rows = await load();
  if (!rows.length) {
    // A site installed before the auth pages existed gets them on the first
    // visit. The seed never replaces a page that exists under that slug in any
    // state, so an unpublished or trashed page still falls through.
    const { ensureBuiltinContentTypes } = await import("../../lib/content/content-types-db.js");
    await ensureBuiltinContentTypes(siteId);
    rows = await load();
  }
  if (!rows.length) { next(); return; }
  const defaultLocale = await getDefaultLocale(siteId);
  const row = rows.find((candidate) => candidate.locale === defaultLocale) ?? rows[0]!;
  const content = serializeContentRow(row);
  // Carries a CSRF cookie and credential forms: never stored by a browser,
  // proxy or CDN, and never indexed.
  privateAccountResponse(res);
  res.locals.jfPrivateContent = true;
  // The reset link carries its token in the query string; keep it out of Referer.
  if (slug === "reset-password") res.setHeader("Referrer-Policy", "no-referrer");
  await new Promise<void>((resolve, reject) => securityHeaders(req, res, (error) => (error ? reject(error) : resolve())));
  const path = `/${slug}`;
  const html = await withoutSharedCache(async () => {
    const { renderSinglePageHtml } = await import("./public-site.js");
    return renderSinglePageHtml(req, res, path, content.slug, content.locale, preview, [], 1, path, content, false, path);
  });
  const assets = '<link rel="stylesheet" href="/css/auth.css"><script src="/js/auth.js" defer></script>';
  res.type("html").send(html.includes('class="jf-auth-form"') ? html.replace("</head>", assets + "</head>") : html);
}
