import type { NextFunction, Request, Response } from "express";
import {
  getActiveLocaleCodes,
  getDefaultLocale,
  resolveContentLocale,
} from "../lib/i18n/languages-db.js";
import { matchActiveLocale, parseLocalePrefix, pickLocaleFromHeader } from "../lib/i18n/locales.js";
import { createTranslator, type MessageCatalog } from "../lib/i18n/translate.js";

const LOCALE_COOKIE = "jf_locale";

declare global {
  namespace Express {
    interface Request {
      locale?: string;
      localePrefix?: string;
      t?: (key: string, vars?: Record<string, string | number>) => string;
    }
  }
}

/** Load server-side message catalog for a locale. */
async function loadCatalog(locale: string): Promise<MessageCatalog> {
  const base = locale.split("-")[0] ?? locale;
  for (const code of [locale, base, "en"]) {
    try {
      return (await import(`../lib/i18n/site-catalogs/${code}.json`, { with: { type: "json" } }))
        .default as MessageCatalog;
    } catch {
      // try next
    }
  }
  return {};
}

export async function localeMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const active = await getActiveLocaleCodes();
    const defaultLocale = await getDefaultLocale();

    let locale = matchActiveLocale(req.query.lang as string | undefined, active);
    if (!locale) locale = matchActiveLocale(req.cookies?.[LOCALE_COOKIE], active);
    if (!locale) locale = pickLocaleFromHeader(req.headers["accept-language"], active);
    if (!locale) {
      locale = await resolveContentLocale(defaultLocale);
    }

    req.locale = locale;
    res.locals.locale = locale;
    res.locals.activeLocales = active;

    const catalog = await loadCatalog(locale);
    const t = createTranslator(catalog);
    req.t = t;
    res.locals.t = t;

    next();
  } catch (err) {
    next(err);
  }
}

export function setLocaleCookie(res: Response, locale: string): void {
  res.cookie(LOCALE_COOKIE, locale, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
}

export { LOCALE_COOKIE, parseLocalePrefix };
