import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { interpolate, lookupMessage } from "./translate";
import { getAdminSsrPayload, initialJson } from "../ssr-data";

export const ADMIN_UI_LOCALES = ["en", "nl", "de", "fr", "es", "pl", "uk", "ru"] as const;
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

function detectInitialLocale(): AdminUiLocale {
  const ssrLocale = getAdminSsrPayload()?.locale;
  if (ssrLocale && (ADMIN_UI_LOCALES as readonly string[]).includes(ssrLocale)) {
    return ssrLocale as AdminUiLocale;
  }
  const stored = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
  if (stored && (ADMIN_UI_LOCALES as readonly string[]).includes(stored)) {
    return stored as AdminUiLocale;
  }
  const browser = typeof navigator === "undefined" ? "en" : navigator.language.split("-")[0];
  if ((ADMIN_UI_LOCALES as readonly string[]).includes(browser)) {
    return browser as AdminUiLocale;
  }
  return "en";
}

/**
 * The bundled English catalog, loaded only when the server cannot answer.
 * Kept out of the initial admin bundle: every page normally gets its
 * catalogs from the server-rendered payload or `/api/i18n`.
 */
let embedded: Messages | null = null;

async function embeddedEnglish(): Promise<Messages> {
  embedded ??= (await import("./embedded-en")).EMBEDDED_EN;
  return embedded;
}

/**
 * Load the English fallback ahead of rendering where size does not matter:
 * the server before its first render, and the tests. Browsers fetch it only
 * when the server's catalogs do not arrive.
 */
export async function preloadEnglishFallback(): Promise<void> {
  await embeddedEnglish();
}

async function fetchCatalog(locale: string): Promise<Messages> {
  const fallback = async () => (locale === "en" ? embeddedEnglish() : {});
  try {
    const res = await fetch(`/api/i18n/${locale}`, { cache: "no-store" });
    if (!res.ok) return fallback();
    const data = (await res.json()) as { messages?: Messages };
    return data.messages ?? fallback();
  } catch {
    return fallback();
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const initialLocale = detectInitialLocale();
  const initialPrimary = initialJson<{ messages?: Messages }>(
    `/api/i18n/${initialLocale}`,
  )?.messages;
  const initialFallback = initialJson<{ messages?: Messages }>("/api/i18n/en")?.messages;
  const [locale, setLocaleState] = useState<AdminUiLocale>(initialLocale);
  const [messages, setMessages] = useState<Messages>(initialPrimary ?? {});
  const [fallback, setFallback] = useState<Messages>(initialFallback ?? embedded ?? {});
  const [loading, setLoading] = useState(!initialPrimary);

  useEffect(() => {
    let cancelled = false;
    if (!initialJson(`/api/i18n/${locale}`)) setLoading(true);

    /** English is its own fallback; another language falls back to the server's English catalog. */
    const english = locale === "en" ? null : fetchCatalog("en");
    Promise.all([fetchCatalog(locale), english])
      .then(([primary, en]) => {
        if (cancelled) return;
        setMessages(primary);
        setFallback(en ?? primary);
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
      const msg =
        lookupMessage(messages, key, locale, vars) ??
        lookupMessage(fallback, key, "en", vars) ??
        (embedded ? lookupMessage(embedded, key, "en", vars) : undefined) ??
        key;
      return interpolate(msg, vars);
    },
    [messages, fallback, locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t, loading }), [locale, setLocale, t, loading]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used within I18nProvider");
  return ctx;
}
