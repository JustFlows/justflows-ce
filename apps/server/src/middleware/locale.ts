import type { NextFunction, Request, Response } from "express";
import {
  getActiveLocaleCodes,
  getDefaultLocale,
  resolveContentLocale,
} from "../lib/i18n/languages-db.js";
import { normalizeLocale, pickLocaleFromHeader } from "../lib/i18n/locales.js";
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
      return (await import(`../lib/i18n/catalogs/${code}.json`, { with: { type: "json" } }))
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

    let locale = normalizeLocale(req.query.lang as string | undefined);
    if (!locale) locale = normalizeLocale(req.cookies?.[LOCALE_COOKIE]);
    if (!locale) locale = pickLocaleFromHeader(req.headers["accept-language"], active);
    if (!locale || !active.includes(locale)) {
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

/** Parse optional locale prefix from URL path (e.g. /nl/about → locale=nl, path=/about). */
export function parseLocalePrefix(path: string, activeLocales: string[]): {
  locale: string | null;
  restPath: string;
} {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return { locale: null, restPath: "/" };

  const first = normalizeLocale(segments[0]);
  if (first && activeLocales.includes(first)) {
    const rest = segments.slice(1).join("/");
    return { locale: first, restPath: rest ? `/${rest}` : "/" };
  }

  return { locale: null, restPath: path.startsWith("/") ? path : `/${path}` };
}

export function setLocaleCookie(res: Response, locale: string): void {
  res.cookie(LOCALE_COOKIE, locale, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
}

export { LOCALE_COOKIE };
