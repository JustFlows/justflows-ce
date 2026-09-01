import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_CONFIG,
  DEFAULT_TEXT,
  loadConfig,
  saveConfig,
  policyHash,
  publicConfig,
  resolveLocale,
  safeCssValue,
  textFor,
} from "./config.js";

function fakeSettings(initial: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => void store.set(key, value)),
    delete: vi.fn(async (key: string) => void store.delete(key)),
  };
}

describe("config", () => {
  it("returns defaults with one English translation", async () => {
    const cfg = await loadConfig({ settings: fakeSettings() } as never);
    expect(cfg).toEqual(DEFAULT_CONFIG);
    expect(cfg.translations["en"]?.bannerTitle).toBe(DEFAULT_TEXT.bannerTitle);
    expect(cfg.defaultLocale).toBe("en");
  });

  it("logs consent by default and can be turned off", async () => {
    const ctx = { settings: fakeSettings() } as never;
    expect((await loadConfig(ctx)).logConsent).toBe(true);
    const off = await saveConfig(ctx, { logConsent: false });
    expect(off.logConsent).toBe(false);
    // an empty record URL tells the runtime not to beacon
    expect(publicConfig(off, "/ext/justflows.consent/record").recordUrl).toBe("");
    expect(publicConfig({ ...off, logConsent: true }, "/x/record").recordUrl).toBe("/x/record");
  });

  it("merges a patch and coerces types", async () => {
    const settings = fakeSettings();
    const ctx = { settings } as never;
    const saved = await saveConfig(ctx, {
      enabled: true,
      displayMode: "eu",
      categories: { preferences: false } as never,
    });
    expect(saved.enabled).toBe(true);
    expect(saved.displayMode).toBe("eu");
    expect(saved.categories).toEqual({ preferences: false, analytics: true, marketing: true });
    expect((await loadConfig(ctx)).enabled).toBe(true);
  });

  it("migrates a pre-1.0 flat-text config into translations", async () => {
    const legacy = {
      enabled: true,
      bannerTitle: "Cookies",
      bannerBody: "We use them.",
      acceptAllLabel: "Yes",
      defaultLocale: "nl",
    };
    const cfg = await loadConfig({ settings: fakeSettings({ config: legacy }) } as never);
    expect(cfg.translations["nl"]?.bannerTitle).toBe("Cookies");
    expect(cfg.translations["nl"]?.acceptAllLabel).toBe("Yes");
    // untouched fields fall back to defaults
    expect(cfg.translations["nl"]?.saveLabel).toBe(DEFAULT_TEXT.saveLabel);
    expect(cfg.defaultLocale).toBe("nl");
  });

  it("keeps and validates multiple locales", async () => {
    const ctx = { settings: fakeSettings() } as never;
    const saved = await saveConfig(ctx, {
      translations: {
        en: { bannerTitle: "Privacy" },
        "nl-NL": { bannerTitle: "Privacy (nl)" },
        "bad key!": { bannerTitle: "dropped" },
      } as never,
    });
    expect(Object.keys(saved.translations).sort()).toEqual(["en", "nl-NL"]);
    expect(saved.translations["nl-NL"]?.bannerBody).toBe(DEFAULT_TEXT.bannerBody);
  });

  it("policy hash ignores localized text but tracks policy version and snippets", () => {
    const a = policyHash(DEFAULT_CONFIG);
    const textChanged = {
      ...DEFAULT_CONFIG,
      translations: { en: { ...DEFAULT_TEXT, bannerBody: "totally different" } },
    };
    expect(policyHash(textChanged)).toBe(a);
    expect(policyHash({ ...DEFAULT_CONFIG, policyVersion: "2" })).not.toBe(a);
    expect(policyHash({ ...DEFAULT_CONFIG, analyticsSnippet: "<script></script>" })).not.toBe(a);
  });

  it("resolveLocale falls through exact, base, then default", () => {
    expect(resolveLocale(["en", "nl-NL", "de"], "nl-NL", "en")).toBe("nl-NL");
    expect(resolveLocale(["en", "nl", "de"], "nl-BE", "en")).toBe("nl");
    expect(resolveLocale(["en", "de"], "fr", "en")).toBe("en");
    expect(resolveLocale(["de", "fr"], "es", "en")).toBe("de");
  });

  it("textFor picks a locale and falls back", () => {
    const cfg = {
      ...DEFAULT_CONFIG,
      defaultLocale: "en",
      translations: { en: DEFAULT_TEXT, nl: { ...DEFAULT_TEXT, bannerTitle: "Privacy (nl)" } },
    };
    expect(textFor(cfg, "nl-NL").bannerTitle).toBe("Privacy (nl)");
    expect(textFor(cfg, "fr").bannerTitle).toBe(DEFAULT_TEXT.bannerTitle);
    expect(textFor(cfg).bannerTitle).toBe(DEFAULT_TEXT.bannerTitle);
  });
});

describe("design", () => {
  it("defaults to a bottom-left box that inherits theme colours", async () => {
    const cfg = await loadConfig({ settings: fakeSettings() } as never);
    expect(cfg.design.layout).toBe("box");
    expect(cfg.design.position).toBe("bottom-left");
    expect(cfg.design.useThemeColors).toBe(true);
  });

  it("keeps position compatible with the layout", async () => {
    const ctx = { settings: fakeSettings() } as never;
    const modal = await saveConfig(ctx, {
      design: { layout: "modal", position: "top-left" } as never,
    });
    expect(modal.design.position).toBe("center");
    const bar = await saveConfig(ctx, {
      design: { layout: "bar", position: "bottom-right" } as never,
    });
    expect(bar.design.position).toBe("bottom");
  });

  it("rejects unsafe CSS values", () => {
    expect(safeCssValue("#3b82f6", "#000")).toBe("#3b82f6");
    expect(safeCssValue("rgba(0,0,0,0.5)", "#000")).toBe("rgba(0,0,0,0.5)");
    expect(safeCssValue("12px", "0")).toBe("12px");
    expect(safeCssValue("red; } body { display:none", "#000")).toBe("#000");
    expect(safeCssValue("url(x)", "#000")).toBe("#000");
    expect(safeCssValue("", "#abc")).toBe("#abc");
  });

  it("sanitises colours through saveConfig", async () => {
    const ctx = { settings: fakeSettings() } as never;
    const saved = await saveConfig(ctx, {
      design: {
        useThemeColors: false,
        colors: { background: "#111827", accent: "javascript:alert(1)" },
      } as never,
    });
    expect(saved.design.colors.background).toBe("#111827");
    expect(saved.design.colors.accent).toBe(DEFAULT_CONFIG.design.colors.accent);
  });
});

describe("publicConfig", () => {
  it("exposes only offered categories, design, and every translation", () => {
    const cfg = {
      ...DEFAULT_CONFIG,
      categories: { preferences: false, analytics: true, marketing: false },
      translations: { en: DEFAULT_TEXT, nl: { ...DEFAULT_TEXT } },
    };
    const pub = publicConfig(cfg, "/ext/justflows.consent/record");
    expect(pub.categories).toEqual(["analytics"]);
    expect(Object.keys(pub.i18n).sort()).toEqual(["en", "nl"]);
    expect(Object.keys(pub.i18n["en"]!.categories)).toEqual(["analytics"]);
    expect(pub.design.layout).toBe("box");
    expect(pub).not.toHaveProperty("analyticsSnippet");
  });
});
