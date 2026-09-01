import { createHash } from "node:crypto";
import type { PluginContext } from "@justflows/sdk";

/** Consent categories. `necessary` is always granted and cannot be declined. */
export const OPTIONAL_CATEGORIES = ["preferences", "analytics", "marketing"] as const;
export type OptionalCategory = (typeof OPTIONAL_CATEGORIES)[number];
export type ConsentCategory = "necessary" | OptionalCategory;

export type DisplayMode = "always" | "eu" | "off";

export const LAYOUTS = ["bar", "box", "modal"] as const;
export type Layout = (typeof LAYOUTS)[number];

export const POSITIONS = [
  "top",
  "bottom",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "center",
] as const;
export type Position = (typeof POSITIONS)[number];

/** Visual design of the banner and preference center. */
export interface ConsentDesign {
  /** `bar` = full-width strip, `box` = floating card, `modal` = centered + backdrop. */
  layout: Layout;
  /** Where the banner sits. `center` is modal-only; `bar` honours only top/bottom. */
  position: Position;
  /** Inherit the active theme's colours and ignore the palette below. */
  useThemeColors: boolean;
  colors: {
    background: string;
    text: string;
    accent: string;
    accentText: string;
    border: string;
    backdrop: string;
  };
  /** CSS lengths. */
  panelRadius: string;
  buttonRadius: string;
  /** Max width of a `box`/`modal` panel. */
  width: string;
}

/** Every visitor-facing string, one set per locale. */
export interface LocalizedText {
  bannerTitle: string;
  bannerBody: string;
  privacyPolicyLabel: string;
  acceptAllLabel: string;
  rejectAllLabel: string;
  saveLabel: string;
  preferencesLabel: string;
  necessaryName: string;
  necessaryDescription: string;
  embedNote: string;
  embedUnlockLabel: string;
  categories: Record<OptionalCategory, { name: string; description: string }>;
}

export interface ConsentConfig {
  /** Master switch. When false the plugin injects nothing on the public site. */
  enabled: boolean;
  /** `always`, `eu` (best-effort, client-side timezone check), or `off`. */
  displayMode: DisplayMode;
  /**
   * Store one audit record per consent decision. Off = the banner still works
   * and enforces choices, but nothing is written to `plugin_data` and no beacon
   * is sent — use when audit records are not needed and table growth matters.
   */
  logConsent: boolean;
  /** Bumped by the operator whenever the policy or gated snippets change. */
  policyVersion: string;
  privacyPolicyUrl: string;
  /** CSS selector whose clicks re-open the preference center. */
  reopenSelector: string;
  /** Which optional categories are offered. `necessary` is implicit. */
  categories: Record<OptionalCategory, boolean>;
  /** Replace off-site iframes/oEmbeds with a placeholder until `marketing` is granted. */
  gateEmbeds: boolean;
  /** Raw `<head>` HTML gated behind the `analytics` category (scripts are language-agnostic). */
  analyticsSnippet: string;
  /** Raw `<head>` HTML gated behind the `marketing` category. */
  marketingSnippet: string;
  /** Visual design and placement of the banner. */
  design: ConsentDesign;
  /** Locale used when a visitor's language has no translation. */
  defaultLocale: string;
  /** Visitor-facing text per BCP-47 locale code (`en`, `nl`, `de-DE`, …). */
  translations: Record<string, LocalizedText>;
}

const SETTINGS_KEY = "config";
const LOCALE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;
const MAX_LOCALES = 40;

/**
 * A conservative CSS value: colours (`#rgb`, `rgb()/rgba()/hsl()/hsla()`,
 * named), and short lengths (`12px`, `1.5rem`, `50%`). Anything with a
 * delimiter that could break out of a declaration is rejected — the value is
 * later assigned through `style.setProperty`, but validating keeps the stored
 * config clean and the admin preview safe.
 */
const CSS_VALUE_RE =
  /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)|[a-z]+|[0-9.]+(px|rem|em|%|vw|vh))$/i;

export function safeCssValue(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim().slice(0, 64) : "";
  if (!raw) return fallback;
  if (/[;{}<>]|url\(|expression|javascript:|@import/i.test(raw)) return fallback;
  return CSS_VALUE_RE.test(raw) ? raw : fallback;
}

export const DEFAULT_DESIGN: ConsentDesign = {
  layout: "box",
  position: "bottom-left",
  useThemeColors: true,
  colors: {
    background: "#ffffff",
    text: "#1a1a1a",
    accent: "#2563eb",
    accentText: "#ffffff",
    border: "#e2e8f0",
    backdrop: "rgba(0,0,0,0.45)",
  },
  panelRadius: "12px",
  buttonRadius: "8px",
  width: "460px",
};

function coerceDesign(raw: unknown): ConsentDesign {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const colorsRaw = (
    value["colors"] && typeof value["colors"] === "object" ? value["colors"] : {}
  ) as Record<string, unknown>;
  const layout = (LAYOUTS as readonly string[]).includes(String(value["layout"]))
    ? (value["layout"] as Layout)
    : DEFAULT_DESIGN.layout;
  let position = (POSITIONS as readonly string[]).includes(String(value["position"]))
    ? (value["position"] as Position)
    : DEFAULT_DESIGN.position;
  // Keep position compatible with the layout.
  if (layout === "modal") position = "center";
  else if (position === "center") position = "bottom";
  else if (layout === "bar" && position !== "top" && position !== "bottom") {
    position = position.startsWith("top") ? "top" : "bottom";
  }
  return {
    layout,
    position,
    useThemeColors: value["useThemeColors"] === undefined ? true : Boolean(value["useThemeColors"]),
    colors: {
      background: safeCssValue(colorsRaw["background"], DEFAULT_DESIGN.colors.background),
      text: safeCssValue(colorsRaw["text"], DEFAULT_DESIGN.colors.text),
      accent: safeCssValue(colorsRaw["accent"], DEFAULT_DESIGN.colors.accent),
      accentText: safeCssValue(colorsRaw["accentText"], DEFAULT_DESIGN.colors.accentText),
      border: safeCssValue(colorsRaw["border"], DEFAULT_DESIGN.colors.border),
      backdrop: safeCssValue(colorsRaw["backdrop"], DEFAULT_DESIGN.colors.backdrop),
    },
    panelRadius: safeCssValue(value["panelRadius"], DEFAULT_DESIGN.panelRadius),
    buttonRadius: safeCssValue(value["buttonRadius"], DEFAULT_DESIGN.buttonRadius),
    width: safeCssValue(value["width"], DEFAULT_DESIGN.width),
  };
}

export const DEFAULT_TEXT: LocalizedText = {
  bannerTitle: "We value your privacy",
  bannerBody:
    "We use cookies to run this site and, with your consent, to measure traffic and personalise content. You can accept all, reject non-essential cookies, or choose per category.",
  privacyPolicyLabel: "Privacy policy",
  acceptAllLabel: "Accept all",
  rejectAllLabel: "Reject non-essential",
  saveLabel: "Save preferences",
  preferencesLabel: "Manage preferences",
  necessaryName: "Strictly necessary",
  necessaryDescription: "Required for the site to work. Always on.",
  embedNote: "This content is hosted off-site and is blocked until you accept marketing cookies.",
  embedUnlockLabel: "Load content",
  categories: {
    preferences: {
      name: "Preferences",
      description:
        "Remembers choices you make, such as language or region, to personalise the site.",
    },
    analytics: {
      name: "Analytics",
      description:
        "Helps us understand how visitors use the site so we can improve it. Aggregated only.",
    },
    marketing: {
      name: "Marketing",
      description: "Used to show you relevant content and measure the performance of campaigns.",
    },
  },
};

export const DEFAULT_CONFIG: ConsentConfig = {
  enabled: false,
  displayMode: "always",
  logConsent: true,
  policyVersion: "1",
  privacyPolicyUrl: "",
  reopenSelector: ".jf-consent-reopen",
  categories: { preferences: true, analytics: true, marketing: true },
  gateEmbeds: true,
  analyticsSnippet: "",
  marketingSnippet: "",
  design: DEFAULT_DESIGN,
  defaultLocale: "en",
  translations: { en: DEFAULT_TEXT },
};

function str(value: unknown, max: number, fallback = ""): string {
  if (typeof value === "string") return value.slice(0, max);
  if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, max);
  return fallback;
}

function coerceCategoryCopy(raw: unknown): LocalizedText["categories"] {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = {} as LocalizedText["categories"];
  for (const category of OPTIONAL_CATEGORIES) {
    const entry = (
      value[category] && typeof value[category] === "object" ? value[category] : {}
    ) as Record<string, unknown>;
    out[category] = {
      name: str(entry["name"], 80, DEFAULT_TEXT.categories[category].name),
      description: str(entry["description"], 400, DEFAULT_TEXT.categories[category].description),
    };
  }
  return out;
}

/** Fill any missing field from `DEFAULT_TEXT` so a partial translation never blanks the UI. */
export function coerceText(raw: unknown): LocalizedText {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    bannerTitle: str(value["bannerTitle"], 200, DEFAULT_TEXT.bannerTitle),
    bannerBody: str(value["bannerBody"], 4000, DEFAULT_TEXT.bannerBody),
    privacyPolicyLabel: str(value["privacyPolicyLabel"], 80, DEFAULT_TEXT.privacyPolicyLabel),
    acceptAllLabel: str(value["acceptAllLabel"], 80, DEFAULT_TEXT.acceptAllLabel),
    rejectAllLabel: str(value["rejectAllLabel"], 80, DEFAULT_TEXT.rejectAllLabel),
    saveLabel: str(value["saveLabel"], 80, DEFAULT_TEXT.saveLabel),
    preferencesLabel: str(value["preferencesLabel"], 80, DEFAULT_TEXT.preferencesLabel),
    necessaryName: str(value["necessaryName"], 80, DEFAULT_TEXT.necessaryName),
    necessaryDescription: str(
      value["necessaryDescription"],
      400,
      DEFAULT_TEXT.necessaryDescription,
    ),
    embedNote: str(value["embedNote"], 300, DEFAULT_TEXT.embedNote),
    embedUnlockLabel: str(value["embedUnlockLabel"], 80, DEFAULT_TEXT.embedUnlockLabel),
    categories: coerceCategoryCopy(value["categories"]),
  };
}

/** Pre-1.0 configs stored the text flat, in one language. Wrap it into `translations`. */
function migrateFlatText(value: Record<string, unknown>): Record<string, unknown> | null {
  if (value["translations"] && typeof value["translations"] === "object") return null;
  if (typeof value["bannerTitle"] !== "string" && typeof value["bannerBody"] !== "string") {
    return null;
  }
  const legacyCats =
    value["categories"] && typeof value["categories"] === "object"
      ? (value["categories"] as Record<string, unknown>)
      : {};
  return {
    bannerTitle: value["bannerTitle"],
    bannerBody: value["bannerBody"],
    acceptAllLabel: value["acceptAllLabel"],
    rejectAllLabel: value["rejectAllLabel"],
    saveLabel: value["saveLabel"],
    preferencesLabel: value["preferencesLabel"],
    embedNote: value["embedNote"],
    embedUnlockLabel: value["embedUnlockLabel"],
    // legacy `categories` was a boolean on/off map, not copy — ignore for text.
    categories: OPTIONAL_CATEGORIES.reduce<Record<string, unknown>>((acc, category) => {
      acc[category] = typeof legacyCats[category] === "object" ? legacyCats[category] : undefined;
      return acc;
    }, {}),
  };
}

function coerceTranslations(raw: unknown, fallbackLocale: string): Record<string, LocalizedText> {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, LocalizedText> = {};
  for (const [code, text] of Object.entries(value).slice(0, MAX_LOCALES)) {
    if (!LOCALE_RE.test(code)) continue;
    out[code] = coerceText(text);
  }
  if (Object.keys(out).length === 0) {
    out[LOCALE_RE.test(fallbackLocale) ? fallbackLocale : "en"] = { ...DEFAULT_TEXT };
  }
  return out;
}

function coerceConfig(raw: unknown): ConsentConfig {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const displayMode: DisplayMode =
    value["displayMode"] === "eu" ||
    value["displayMode"] === "off" ||
    value["displayMode"] === "always"
      ? value["displayMode"]
      : DEFAULT_CONFIG.displayMode;

  const catsRaw = (
    value["categories"] && typeof value["categories"] === "object" ? value["categories"] : {}
  ) as Record<string, unknown>;
  const offered: Record<OptionalCategory, boolean> = {
    preferences: catsRaw["preferences"] === undefined ? true : Boolean(catsRaw["preferences"]),
    analytics: catsRaw["analytics"] === undefined ? true : Boolean(catsRaw["analytics"]),
    marketing: catsRaw["marketing"] === undefined ? true : Boolean(catsRaw["marketing"]),
  };

  const defaultLocale = LOCALE_RE.test(String(value["defaultLocale"] ?? ""))
    ? String(value["defaultLocale"])
    : DEFAULT_CONFIG.defaultLocale;

  const migrated = migrateFlatText(value);
  const translations = migrated
    ? { [defaultLocale]: coerceText(migrated) }
    : coerceTranslations(value["translations"], defaultLocale);

  return {
    enabled: Boolean(value["enabled"] ?? DEFAULT_CONFIG.enabled),
    logConsent: value["logConsent"] === undefined ? true : Boolean(value["logConsent"]),
    displayMode,
    policyVersion: str(value["policyVersion"], 64, DEFAULT_CONFIG.policyVersion) || "1",
    privacyPolicyUrl: str(value["privacyPolicyUrl"], 2048),
    reopenSelector: str(value["reopenSelector"], 200) || DEFAULT_CONFIG.reopenSelector,
    categories: offered,
    gateEmbeds: Boolean(value["gateEmbeds"] ?? DEFAULT_CONFIG.gateEmbeds),
    analyticsSnippet: str(value["analyticsSnippet"], 20000),
    marketingSnippet: str(value["marketingSnippet"], 20000),
    design: coerceDesign(value["design"]),
    defaultLocale: translations[defaultLocale]
      ? defaultLocale
      : (Object.keys(translations)[0] ?? "en"),
    translations,
  };
}

export async function loadConfig(ctx: Pick<PluginContext, "settings">): Promise<ConsentConfig> {
  return coerceConfig(await ctx.settings.get(SETTINGS_KEY));
}

export async function saveConfig(
  ctx: Pick<PluginContext, "settings">,
  patch: Partial<ConsentConfig>,
): Promise<ConsentConfig> {
  const next = coerceConfig({ ...(await loadConfig(ctx)), ...patch });
  await ctx.settings.set(SETTINGS_KEY, next);
  return next;
}

/**
 * A stable hash of the policy a visitor consents to. Deliberately excludes the
 * localized display text — translating the banner must not invalidate consent;
 * the operator bumps `policyVersion` for that.
 */
export function policyHash(config: ConsentConfig): string {
  return createHash("sha256")
    .update(
      [
        config.policyVersion,
        config.privacyPolicyUrl,
        JSON.stringify(config.categories),
        config.analyticsSnippet,
        config.marketingSnippet,
      ].join("\n"),
      "utf8",
    )
    .digest("hex");
}

/** The localized text for a locale, falling back to the default locale then `DEFAULT_TEXT`. */
export function textFor(config: ConsentConfig, locale?: string): LocalizedText {
  const codes = Object.keys(config.translations);
  const code = locale
    ? resolveLocale(codes, locale, config.defaultLocale)
    : config.translations[config.defaultLocale]
      ? config.defaultLocale
      : (codes[0] ?? "");
  return config.translations[code] ?? config.translations[config.defaultLocale] ?? DEFAULT_TEXT;
}

/** Best BCP-47 match: exact, then base language, then default, then anything. */
export function resolveLocale(available: string[], wanted: string, fallback: string): string {
  const norm = wanted.trim().toLowerCase();
  const lower = new Map(available.map((code) => [code.toLowerCase(), code]));
  if (lower.has(norm)) return lower.get(norm)!;
  const base = norm.split("-")[0]!;
  if (lower.has(base)) return lower.get(base)!;
  const byBase = available.find((code) => code.toLowerCase().split("-")[0] === base);
  if (byBase) return byBase;
  if (available.includes(fallback)) return fallback;
  return available[0] ?? fallback;
}

/** The subset of config that is safe to expose in the public page. */
export interface PublicConsentConfig {
  displayMode: DisplayMode;
  policyVersion: string;
  policyHash: string;
  privacyPolicyUrl: string;
  reopenSelector: string;
  recordUrl: string;
  cookiesUrl: string;
  categories: OptionalCategory[];
  design: ConsentDesign;
  defaultLocale: string;
  i18n: Record<string, LocalizedText>;
}

export function publicConfig(
  config: ConsentConfig,
  recordUrl: string,
  cookiesUrl = "",
): PublicConsentConfig {
  const offered = OPTIONAL_CATEGORIES.filter((category) => config.categories[category]);
  const i18n: Record<string, LocalizedText> = {};
  for (const [code, text] of Object.entries(config.translations)) {
    i18n[code] = {
      ...text,
      categories: offered.reduce(
        (acc, category) => {
          acc[category] = text.categories[category];
          return acc;
        },
        {} as LocalizedText["categories"],
      ),
    };
  }
  return {
    displayMode: config.displayMode,
    policyVersion: config.policyVersion,
    policyHash: policyHash(config),
    privacyPolicyUrl: config.privacyPolicyUrl,
    reopenSelector: config.reopenSelector,
    // Empty when logging is off — the runtime then sends no beacon.
    recordUrl: config.logConsent ? recordUrl : "",
    cookiesUrl,
    categories: offered,
    design: config.design,
    defaultLocale: config.translations[config.defaultLocale]
      ? config.defaultLocale
      : (Object.keys(config.translations)[0] ?? "en"),
    i18n,
  };
}
