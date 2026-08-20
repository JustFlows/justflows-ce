import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { EMBEDDED_EN } from "./embedded-en";

export const ADMIN_UI_LOCALES = ["en", "nl", "de", "fr", "es"] as const;
export type AdminUiLocale = (typeof ADMIN_UI_LOCALES)[number];

type Messages = Record<string, string>;

interface I18nContextValue {
  locale: AdminUiLocale;
  setLocale: (locale: AdminUiLocale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  loading: boolean;
}

const STORAGE_KEY = "jf_admin_locale";

const I18nContext = createContext<I18nContextValue | null>(null);

function interpolate(msg: string, vars?: Record<string, string | number>): string {
  if (!vars) return msg;
  let out = msg;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }
  return out;
}

function detectInitialLocale(): AdminUiLocale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && (ADMIN_UI_LOCALES as readonly string[]).includes(stored)) {
    return stored as AdminUiLocale;
  }
  const browser = navigator.language.split("-")[0];
  if ((ADMIN_UI_LOCALES as readonly string[]).includes(browser)) {
    return browser as AdminUiLocale;
  }
  return "en";
}

async function fetchCatalog(locale: string): Promise<Messages> {
  try {
    const res = await fetch(`/api/i18n/${locale}`, { cache: "no-store" });
    if (!res.ok) return locale === "en" ? EMBEDDED_EN : {};
    const data = (await res.json()) as { messages?: Messages };
    return data.messages ?? (locale === "en" ? EMBEDDED_EN : {});
  } catch {
    return locale === "en" ? EMBEDDED_EN : {};
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AdminUiLocale>(detectInitialLocale);
  const [messages, setMessages] = useState<Messages>({});
  const [fallback, setFallback] = useState<Messages>(EMBEDDED_EN);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetchCatalog(locale),
      locale === "en" ? Promise.resolve(EMBEDDED_EN) : fetchCatalog("en"),
    ])
      .then(([primary, en]) => {
        if (cancelled) return;
        setMessages(primary);
        setFallback(en);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [locale]);

  const setLocale = useCallback((next: AdminUiLocale) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLocaleState(next);
    fetch("/api/languages/preference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: next }),
    }).catch(() => null);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const msg = messages[key] ?? fallback[key] ?? key;
      return interpolate(msg, vars);
    },
    [messages, fallback],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t, loading }),
    [locale, setLocale, t, loading],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used within I18nProvider");
  return ctx;
}
