import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useSessionRole } from "@components/SessionProvider";
import { useT } from "../../../i18n/I18nProvider";

/* Mirrors plugins/consent/src/config.ts */
type OptionalCategory = "preferences" | "analytics" | "marketing";
type Layout = "bar" | "box" | "modal";
type Position =
  "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";

interface LocalizedText {
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

interface ConsentDesign {
  layout: Layout;
  position: Position;
  useThemeColors: boolean;
  colors: {
    background: string;
    text: string;
    accent: string;
    accentText: string;
    border: string;
    backdrop: string;
  };
  panelRadius: string;
  buttonRadius: string;
  width: string;
}

interface ConsentConfig {
  enabled: boolean;
  displayMode: "always" | "eu" | "off";
  logConsent: boolean;
  policyVersion: string;
  privacyPolicyUrl: string;
  reopenSelector: string;
  categories: Record<OptionalCategory, boolean>;
  gateEmbeds: boolean;
  analyticsSnippet: string;
  marketingSnippet: string;
  design: ConsentDesign;
  defaultLocale: string;
  translations: Record<string, LocalizedText>;
}

interface ConsentRecord {
  cid: string;
  policyVersion: string;
  policyHash: string;
  choices: Record<string, boolean>;
  locale: string;
  device: string;
  method: string;
  ts: string;
}

interface SiteLanguage {
  code: string;
  nativeName: string;
  isDefault?: boolean;
}

interface RegistryCookie {
  name: string;
  category: string; // declared
  effectiveCategory: string;
  overridden: boolean;
  purpose: string;
  provider?: string;
  duration?: string;
  declaredBy: string;
}

const BASE = "/ext/justflows.consent";
const OPTIONAL: OptionalCategory[] = ["preferences", "analytics", "marketing"];
const ALL_CATEGORIES = ["necessary", "preferences", "analytics", "marketing"] as const;
const LAYOUTS: Layout[] = ["bar", "box", "modal"];
const POSITIONS_BY_LAYOUT: Record<Layout, Position[]> = {
  bar: ["top", "bottom"],
  box: ["top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"],
  modal: ["center"],
};

const TEXT_FIELD_KEYS: Array<[keyof LocalizedText, boolean]> = [
  ["bannerTitle", false],
  ["bannerBody", true],
  ["privacyPolicyLabel", false],
  ["acceptAllLabel", false],
  ["rejectAllLabel", false],
  ["saveLabel", false],
  ["preferencesLabel", false],
  ["necessaryName", false],
  ["necessaryDescription", true],
  ["embedNote", true],
  ["embedUnlockLabel", false],
];

const COLOR_FIELD_KEYS: Array<keyof ConsentDesign["colors"]> = [
  "background",
  "text",
  "accent",
  "accentText",
  "border",
];

export default function ConsentPage() {
  const { t } = useT();
  const canManage = useSessionRole() === "administrator";

  const emptyText: LocalizedText = useMemo(
    () => ({
      bannerTitle: t("consent.defaultText.bannerTitle"),
      bannerBody: t("consent.defaultText.bannerBody"),
      privacyPolicyLabel: t("consent.defaultText.privacyPolicyLabel"),
      acceptAllLabel: t("consent.defaultText.acceptAllLabel"),
      rejectAllLabel: t("consent.defaultText.rejectAllLabel"),
      saveLabel: t("consent.defaultText.saveLabel"),
      preferencesLabel: t("consent.defaultText.preferencesLabel"),
      necessaryName: t("consent.defaultText.necessaryName"),
      necessaryDescription: t("consent.defaultText.necessaryDescription"),
      embedNote: t("consent.defaultText.embedNote"),
      embedUnlockLabel: t("consent.defaultText.embedUnlockLabel"),
      categories: {
        preferences: {
          name: t("consent.defaultText.categories.preferences.name"),
          description: t("consent.defaultText.categories.preferences.description"),
        },
        analytics: {
          name: t("consent.defaultText.categories.analytics.name"),
          description: t("consent.defaultText.categories.analytics.description"),
        },
        marketing: {
          name: t("consent.defaultText.categories.marketing.name"),
          description: t("consent.defaultText.categories.marketing.description"),
        },
      },
    }),
    [t],
  );

  function textFieldLabel(field: keyof LocalizedText): string {
    switch (field) {
      case "bannerTitle":
        return t("consent.textFieldLabel.bannerTitle");
      case "bannerBody":
        return t("consent.textFieldLabel.bannerBody");
      case "privacyPolicyLabel":
        return t("consent.textFieldLabel.privacyPolicyLabel");
      case "acceptAllLabel":
        return t("consent.textFieldLabel.acceptAllLabel");
      case "rejectAllLabel":
        return t("consent.textFieldLabel.rejectAllLabel");
      case "saveLabel":
        return t("consent.textFieldLabel.saveLabel");
      case "preferencesLabel":
        return t("consent.textFieldLabel.preferencesLabel");
      case "necessaryName":
        return t("consent.textFieldLabel.necessaryName");
      case "necessaryDescription":
        return t("consent.textFieldLabel.necessaryDescription");
      case "embedNote":
        return t("consent.textFieldLabel.embedNote");
      case "embedUnlockLabel":
        return t("consent.textFieldLabel.embedUnlockLabel");
      default:
        return field;
    }
  }

  function colorFieldLabel(key: keyof ConsentDesign["colors"]): string {
    switch (key) {
      case "background":
        return t("consent.colorField.background");
      case "text":
        return t("consent.colorField.text");
      case "accent":
        return t("consent.colorField.accent");
      case "accentText":
        return t("consent.colorField.accentText");
      case "border":
        return t("consent.colorField.border");
      case "backdrop":
        return t("consent.modalBackdropLabel");
      default:
        return key;
    }
  }

  function categoryLabel(category: OptionalCategory | "necessary"): string {
    switch (category) {
      case "necessary":
        return t("consent.category.necessary");
      case "preferences":
        return t("consent.category.preferences");
      case "analytics":
        return t("consent.category.analytics");
      case "marketing":
        return t("consent.category.marketing");
      default:
        return category;
    }
  }

  function layoutShortLabel(l: Layout): string {
    switch (l) {
      case "bar":
        return t("consent.layoutShort.bar");
      case "box":
        return t("consent.layoutShort.box");
      case "modal":
        return t("consent.layoutShort.modal");
      default:
        return l;
    }
  }

  function positionLabel(p: Position): string {
    switch (p) {
      case "top":
        return t("consent.position.top");
      case "bottom":
        return t("consent.position.bottom");
      case "top-left":
        return t("consent.position.topLeft");
      case "top-right":
        return t("consent.position.topRight");
      case "bottom-left":
        return t("consent.position.bottomLeft");
      case "bottom-right":
        return t("consent.position.bottomRight");
      case "center":
        return t("consent.position.center");
      default:
        return p;
    }
  }

  const [config, setConfig] = useState<ConsentConfig | null>(null);
  const [languages, setLanguages] = useState<SiteLanguage[]>([]);
  const [activeLocale, setActiveLocale] = useState("");
  const [records, setRecords] = useState<ConsentRecord[]>([]);
  const [cookies, setCookies] = useState<RegistryCookie[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [savingOverrides, setSavingOverrides] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canManage) return;
    setLoading(true);
    Promise.all([
      fetch(`${BASE}/config`).then((r) => r.json()),
      fetch("/api/languages/active")
        .then((r) => r.json())
        .catch(() => ({ languages: [] })),
      fetch(`${BASE}/records?limit=500`).then((r) => r.json()),
      fetch("/api/cookies")
        .then((r) => r.json())
        .catch(() => ({ cookies: [], overrides: {} })),
    ])
      .then(([cfg, langs, recs, cookieReg]) => {
        if (cfg?.error) throw new Error(cfg.error);
        setCookies(Array.isArray(cookieReg?.cookies) ? cookieReg.cookies : []);
        setOverrides(
          cookieReg?.overrides && typeof cookieReg.overrides === "object"
            ? cookieReg.overrides
            : {},
        );
        const list: SiteLanguage[] =
          Array.isArray(langs?.languages) && langs.languages.length
            ? langs.languages
            : [{ code: cfg.defaultLocale || "en", nativeName: t("ui.consentPage.default"), isDefault: true }];
        // Make sure every site language has an editable translation block.
        const translations = { ...cfg.translations };
        const seed = translations[cfg.defaultLocale] ?? emptyText;
        for (const lang of list) {
          if (!translations[lang.code]) {
            translations[lang.code] = JSON.parse(JSON.stringify(seed)) as LocalizedText;
          }
        }
        setConfig({ ...cfg, translations });
        setLanguages(list);
        setActiveLocale(
          list.find((l) => l.code === cfg.defaultLocale)?.code ??
            list.find((l) => l.isDefault)?.code ??
            list[0]?.code ??
            "en",
        );
        setRecords(Array.isArray(recs?.records) ? recs.records : []);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [canManage]);

  function set<K extends keyof ConsentConfig>(key: K, value: ConsentConfig[K]) {
    setConfig((c) => (c ? { ...c, [key]: value } : c));
    setSaved(false);
  }

  function setText(field: keyof LocalizedText, value: string) {
    setConfig((c) => {
      if (!c) return c;
      const current = c.translations[activeLocale] ?? emptyText;
      return {
        ...c,
        translations: { ...c.translations, [activeLocale]: { ...current, [field]: value } },
      };
    });
    setSaved(false);
  }

  function setCategoryCopy(cat: OptionalCategory, part: "name" | "description", value: string) {
    setConfig((c) => {
      if (!c) return c;
      const current = c.translations[activeLocale] ?? emptyText;
      return {
        ...c,
        translations: {
          ...c.translations,
          [activeLocale]: {
            ...current,
            categories: {
              ...current.categories,
              [cat]: { ...current.categories[cat], [part]: value },
            },
          },
        },
      };
    });
    setSaved(false);
  }

  function setDesign<K extends keyof ConsentDesign>(key: K, value: ConsentDesign[K]) {
    setConfig((c) => {
      if (!c) return c;
      const design = { ...c.design, [key]: value };
      if (key === "layout") {
        const allowed = POSITIONS_BY_LAYOUT[value as Layout];
        if (!allowed.includes(design.position)) design.position = allowed[0]!;
      }
      return { ...c, design };
    });
    setSaved(false);
  }

  function setColor(key: keyof ConsentDesign["colors"], value: string) {
    setConfig((c) =>
      c ? { ...c, design: { ...c.design, colors: { ...c.design.colors, [key]: value } } } : c,
    );
    setSaved(false);
  }

  function save() {
    if (!config) return;
    setSaving(true);
    setError("");
    fetch(`${BASE}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    })
      .then(async (r) => {
        const body = (await r.json()) as ConsentConfig & { error?: string };
        if (!r.ok) throw new Error(body.error ?? t("ui.consentPage.saveFailed"));
        // Keep the languages the operator is editing even if the server has not
        // stored an entry for them yet.
        const translations = { ...body.translations };
        for (const lang of languages) {
          if (!translations[lang.code] && config.translations[lang.code]) {
            translations[lang.code] = config.translations[lang.code]!;
          }
        }
        setConfig({ ...body, translations });
        setSaved(true);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSaving(false));
  }

  function erase(cid: string) {
    if (!window.confirm(t("consent.eraseConfirm", { cid }))) return;
    fetch(`${BASE}/records/${encodeURIComponent(cid)}`, { method: "DELETE" })
      .then((r) => {
        if (!r.ok && r.status !== 204) throw new Error(t("ui.consentPage.eraseFailed"));
        setRecords((rows) => rows.filter((row) => row.cid !== cid));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }

  function setOverride(name: string, category: string) {
    setOverrides((o) => {
      const next = { ...o };
      const declared = cookies.find((c) => c.name === name)?.category;
      if (!category || category === declared) delete next[name];
      else next[name] = category;
      return next;
    });
  }

  function saveOverrides() {
    setSavingOverrides(true);
    setError("");
    fetch("/api/cookies/overrides", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overrides }),
    })
      .then(async (r) => {
        const body = (await r.json()) as {
          cookies?: RegistryCookie[];
          overrides?: Record<string, string>;
          error?: string;
        };
        if (!r.ok) throw new Error(body.error ?? t("ui.consentPage.saveFailed"));
        setCookies(body.cookies ?? []);
        setOverrides(body.overrides ?? {});
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSavingOverrides(false));
  }

  const summary = useMemo(() => {
    const totals: Record<string, number> = { total: records.length };
    for (const c of OPTIONAL) totals[c] = records.filter((r) => r.choices?.[c]).length;
    return totals;
  }, [records]);

  const text = config?.translations[activeLocale] ?? emptyText;

  if (!canManage) {
    return (
      <div className="jf-page">
        <div className="jf-alert jf-alert--error" role="alert">
          {t("consent.onlyAdmins")}
        </div>
      </div>
    );
  }

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("consent.pageTitle")}</h1>
          <p>{t("consent.pageDescription")}</p>
        </div>
        <a className="jf-btn jf-btn--ghost" href={`${BASE}/records.csv`}>
          {t("consent.exportRecordsCsv")}
        </a>
      </header>

      {error && (
        <div className="jf-alert jf-alert--error" role="alert">
          {error}
        </div>
      )}
      {saved && <div className="jf-alert">{t("consent.settingsSaved")}</div>}

      {loading || !config ? (
        <div className="jf-card">
          <div className="jf-card__body">{t("common.loading")}</div>
        </div>
      ) : (
        <div className="jf-stack">
          {/* ── Behaviour ─────────────────────────────────────────────── */}
          <div className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">{t("consent.behaviourTitle")}</h2>
            </div>
            <div className="jf-card__body jf-stack">
              <label className="jf-checkrow">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => set("enabled", e.target.checked)}
                />
                <span>{t("consent.showBannerLabel")}</span>
              </label>

              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jfc-mode">
                  {t("consent.displayModeLabel")}
                </label>
                <select
                  id="jfc-mode"
                  className="jf-input"
                  value={config.displayMode}
                  onChange={(e) =>
                    set("displayMode", e.target.value as ConsentConfig["displayMode"])
                  }
                >
                  <option value="always">{t("consent.displayModeAlways")}</option>
                  <option value="eu">{t("consent.displayModeEu")}</option>
                  <option value="off">{t("consent.displayModeOff")}</option>
                </select>
                <p className="jf-field__hint">{t("consent.geoHint")}</p>
              </div>

              <label className="jf-checkrow">
                <input
                  type="checkbox"
                  checked={config.logConsent}
                  onChange={(e) => set("logConsent", e.target.checked)}
                />
                <span>
                  {t("consent.logConsentLabel")}
                  <span className="jf-field__hint" style={{ display: "block", marginTop: 2 }}>
                    {t("consent.logConsentHint")}
                  </span>
                </span>
              </label>

              <div className="jf-grid jf-grid--2">
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jfc-pv">
                    {t("consent.policyVersionLabel")}
                  </label>
                  <input
                    id="jfc-pv"
                    className="jf-input"
                    value={config.policyVersion}
                    onChange={(e) => set("policyVersion", e.target.value)}
                  />
                  <p className="jf-field__hint">{t("consent.policyVersionHint")}</p>
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jfc-purl">
                    {t("consent.privacyPolicyUrlLabel")}
                  </label>
                  <input
                    id="jfc-purl"
                    className="jf-input"
                    value={config.privacyPolicyUrl}
                    onChange={(e) => set("privacyPolicyUrl", e.target.value)}
                  />
                </div>
              </div>

              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jfc-reopen">
                  {t("consent.reopenSelectorLabel")}
                </label>
                <input
                  id="jfc-reopen"
                  className="jf-input"
                  value={config.reopenSelector}
                  onChange={(e) => set("reopenSelector", e.target.value)}
                />
                <p className="jf-field__hint">{t("consent.reopenSelectorHint")}</p>
              </div>
            </div>
          </div>

          {/* ── Categories offered ────────────────────────────────────── */}
          <div className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">{t("consent.categoriesTitle")}</h2>
            </div>
            <div className="jf-card__body jf-stack">
              <p className="jf-meta">
                <strong>{t("consent.category.necessary")}</strong> {t("consent.categoriesIntro")}
              </p>
              {OPTIONAL.map((category) => (
                <label className="jf-checkrow" key={category}>
                  <input
                    type="checkbox"
                    checked={config.categories[category]}
                    onChange={(e) =>
                      set("categories", { ...config.categories, [category]: e.target.checked })
                    }
                  />
                  <span style={{ textTransform: "capitalize" }}>{categoryLabel(category)}</span>
                </label>
              ))}
            </div>
          </div>

          {/* ── Text (per language) ───────────────────────────────────── */}
          <div className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">{t("consent.textSectionTitle")}</h2>
            </div>
            <div className="jf-card__body jf-stack">
              {languages.length > 1 && (
                <div
                  className="jf-tabbar"
                  role="tablist"
                  style={{ display: "flex", gap: 4, flexWrap: "wrap" }}
                >
                  {languages.map((lang) => (
                    <button
                      key={lang.code}
                      type="button"
                      role="tab"
                      aria-selected={activeLocale === lang.code}
                      className={`jf-btn ${activeLocale === lang.code ? "jf-btn--primary" : "jf-btn--ghost"}`}
                      onClick={() => setActiveLocale(lang.code)}
                    >
                      {lang.nativeName} ({lang.code})
                      {lang.code === config.defaultLocale ? " ·" : ""}
                    </button>
                  ))}
                </div>
              )}

              {TEXT_FIELD_KEYS.map(([field, multiline]) => (
                <div className="jf-field" key={field}>
                  <label className="jf-field__label" htmlFor={`jfc-t-${field}`}>
                    {textFieldLabel(field)}
                  </label>
                  {multiline ? (
                    <textarea
                      id={`jfc-t-${field}`}
                      className="jf-input"
                      rows={2}
                      value={text[field] as string}
                      onChange={(e) => setText(field, e.target.value)}
                    />
                  ) : (
                    <input
                      id={`jfc-t-${field}`}
                      className="jf-input"
                      value={text[field] as string}
                      onChange={(e) => setText(field, e.target.value)}
                    />
                  )}
                </div>
              ))}

              {OPTIONAL.filter((c) => config.categories[c]).map((category) => (
                <div className="jf-grid jf-grid--2" key={category}>
                  <div className="jf-field">
                    <label className="jf-field__label" htmlFor={`jfc-cn-${category}`}>
                      {t("consent.categoryNameFieldLabel", { category: categoryLabel(category) })}
                    </label>
                    <input
                      id={`jfc-cn-${category}`}
                      className="jf-input"
                      value={text.categories[category].name}
                      onChange={(e) => setCategoryCopy(category, "name", e.target.value)}
                    />
                  </div>
                  <div className="jf-field">
                    <label className="jf-field__label" htmlFor={`jfc-cd-${category}`}>
                      {t("consent.categoryDescriptionFieldLabel", {
                        category: categoryLabel(category),
                      })}
                    </label>
                    <input
                      id={`jfc-cd-${category}`}
                      className="jf-input"
                      value={text.categories[category].description}
                      onChange={(e) => setCategoryCopy(category, "description", e.target.value)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Design ────────────────────────────────────────────────── */}
          <div className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">{t("consent.designTitle")}</h2>
            </div>
            <div className="jf-card__body jf-stack">
              <div className="jf-grid jf-grid--2">
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jfc-layout">
                    {t("consent.layoutLabel")}
                  </label>
                  <select
                    id="jfc-layout"
                    className="jf-input"
                    value={config.design.layout}
                    onChange={(e) => setDesign("layout", e.target.value as Layout)}
                  >
                    {LAYOUTS.map((l) => (
                      <option key={l} value={l}>
                        {l === "bar"
                          ? t("consent.layoutBar")
                          : l === "box"
                            ? t("consent.layoutBox")
                            : t("consent.layoutModal")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jfc-pos">
                    {t("consent.positionLabel")}
                  </label>
                  <select
                    id="jfc-pos"
                    className="jf-input"
                    value={config.design.position}
                    disabled={config.design.layout === "modal"}
                    onChange={(e) => setDesign("position", e.target.value as Position)}
                  >
                    {POSITIONS_BY_LAYOUT[config.design.layout].map((p) => (
                      <option key={p} value={p}>
                        {positionLabel(p)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="jf-grid jf-grid--2">
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jfc-panelr">
                    {t("consent.panelRadiusLabel")}
                  </label>
                  <input
                    id="jfc-panelr"
                    className="jf-input"
                    value={config.design.panelRadius}
                    onChange={(e) => setDesign("panelRadius", e.target.value)}
                  />
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jfc-btnr">
                    {t("consent.buttonRadiusLabel")}
                  </label>
                  <input
                    id="jfc-btnr"
                    className="jf-input"
                    value={config.design.buttonRadius}
                    onChange={(e) => setDesign("buttonRadius", e.target.value)}
                  />
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jfc-width">
                    {t("consent.panelWidthLabel")}
                  </label>
                  <input
                    id="jfc-width"
                    className="jf-input"
                    value={config.design.width}
                    onChange={(e) => setDesign("width", e.target.value)}
                  />
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jfc-backdrop">
                    {t("consent.modalBackdropLabel")}
                  </label>
                  <input
                    id="jfc-backdrop"
                    className="jf-input"
                    value={config.design.colors.backdrop}
                    onChange={(e) => setColor("backdrop", e.target.value)}
                  />
                </div>
              </div>

              <label className="jf-checkrow">
                <input
                  type="checkbox"
                  checked={config.design.useThemeColors}
                  onChange={(e) => setDesign("useThemeColors", e.target.checked)}
                />
                <span>{t("consent.useThemeColorsLabel")}</span>
              </label>

              {!config.design.useThemeColors && (
                <div className="jf-grid jf-grid--2">
                  {COLOR_FIELD_KEYS.map((key) => (
                    <div className="jf-field" key={key}>
                      <label className="jf-field__label" htmlFor={`jfc-c-${key}`}>
                        {colorFieldLabel(key)}
                      </label>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          id={`jfc-c-${key}`}
                          type="color"
                          value={
                            /^#[0-9a-f]{6}$/i.test(config.design.colors[key])
                              ? config.design.colors[key]
                              : "#000000"
                          }
                          onChange={(e) => setColor(key, e.target.value)}
                          style={{ width: 44, height: 34, padding: 0 }}
                        />
                        <input
                          className="jf-input"
                          value={config.design.colors[key]}
                          onChange={(e) => setColor(key, e.target.value)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <BannerPreview
                design={config.design}
                text={text}
                privacyUrl={config.privacyPolicyUrl}
                previewCaption={t("consent.previewCaption", {
                  layout: layoutShortLabel(config.design.layout),
                  position: positionLabel(config.design.position),
                })}
              />
            </div>
          </div>

          {/* ── Script & embed gating ─────────────────────────────────── */}
          <div className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">{t("consent.scriptEmbedGatingTitle")}</h2>
            </div>
            <div className="jf-card__body jf-stack">
              <label className="jf-checkrow">
                <input
                  type="checkbox"
                  checked={config.gateEmbeds}
                  onChange={(e) => set("gateEmbeds", e.target.checked)}
                />
                <span>{t("consent.gateEmbedsLabel")}</span>
              </label>

              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jfc-as">
                  {t("consent.analyticsSnippetLabel")}
                </label>
                <textarea
                  id="jfc-as"
                  className="jf-input"
                  rows={3}
                  placeholder={t("consent.analyticsSnippetPlaceholder")}
                  value={config.analyticsSnippet}
                  onChange={(e) => set("analyticsSnippet", e.target.value)}
                />
                <p className="jf-field__hint">{t("consent.analyticsSnippetHint")}</p>
              </div>

              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jfc-ms">
                  {t("consent.marketingSnippetLabel")}
                </label>
                <textarea
                  id="jfc-ms"
                  className="jf-input"
                  rows={3}
                  placeholder={t("consent.marketingSnippetPlaceholder")}
                  value={config.marketingSnippet}
                  onChange={(e) => set("marketingSnippet", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="jf-row" style={{ gap: 8 }}>
            <button
              type="button"
              className="jf-btn jf-btn--primary"
              onClick={save}
              disabled={saving}
            >
              {saving ? t("common.saving") : t("consent.saveSettingsButton")}
            </button>
          </div>

          {/* ── Cookie declarations ──────────────────────────────────── */}
          <div className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">{t("consent.cookieDeclarationsTitle")}</h2>
            </div>
            <div className="jf-card__body jf-stack">
              <p className="jf-meta">
                {t("consent.cookieDeclarationsIntro1")} <code>ctx.cookies</code>{" "}
                {t("consent.cookieDeclarationsIntro2")} <code>necessary</code>{" "}
                {t("consent.cookieDeclarationsIntro3")}
              </p>
              {cookies.length === 0 ? (
                <p className="jf-meta">{t("consent.noCookiesRegistered")}</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="jf-table">
                    <thead>
                      <tr>
                        <th>{t("consent.tableHeader.name")}</th>
                        <th>{t("consent.tableHeader.setBy")}</th>
                        <th>{t("consent.tableHeader.purpose")}</th>
                        <th>{t("consent.tableHeader.duration")}</th>
                        <th>{t("consent.tableHeader.declared")}</th>
                        <th>{t("consent.tableHeader.categoryOverride")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cookies.map((cookie) => (
                        <tr key={cookie.name}>
                          <td className="jf-td--mono">{cookie.name}</td>
                          <td>{cookie.provider || cookie.declaredBy}</td>
                          <td>{cookie.purpose}</td>
                          <td>{cookie.duration || "—"}</td>
                          <td style={{ textTransform: "capitalize" }}>
                            {categoryLabel(cookie.category as OptionalCategory | "necessary")}
                          </td>
                          <td>
                            <select
                              className="jf-input"
                              value={overrides[cookie.name] ?? cookie.category}
                              onChange={(e) => setOverride(cookie.name, e.target.value)}
                            >
                              {ALL_CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                  {categoryLabel(c)}
                                  {c === cookie.category ? ` (${t("consent.declaredSuffix")})` : ""}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="jf-row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="jf-btn"
                  onClick={saveOverrides}
                  disabled={savingOverrides || cookies.length === 0}
                >
                  {savingOverrides ? t("common.saving") : t("consent.saveCategoryOverridesButton")}
                </button>
              </div>
            </div>
          </div>

          {/* ── Records ───────────────────────────────────────────────── */}
          <div className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">{t("consent.consentRecordsTitle")}</h2>
            </div>
            <div className="jf-card__body jf-stack">
              {!config.logConsent && (
                <div className="jf-alert">{t("consent.auditLoggingOff")}</div>
              )}
              <p className="jf-meta">
                {t("consent.recordsSummary", {
                  total: summary.total,
                  recordWord:
                    summary.total === 1
                      ? t("consent.recordSingular")
                      : t("consent.recordPlural"),
                  analytics: summary.analytics,
                  marketing: summary.marketing,
                  preferences: summary.preferences,
                })}
              </p>
              {records.length === 0 ? (
                <p className="jf-meta">{t("consent.noRecordsYet")}</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="jf-table">
                    <thead>
                      <tr>
                        <th>{t("consent.recordsTableHeader.recorded")}</th>
                        <th>{t("consent.recordsTableHeader.clientId")}</th>
                        <th>{t("consent.recordsTableHeader.policy")}</th>
                        <th>{t("consent.recordsTableHeader.choices")}</th>
                        <th>{t("consent.recordsTableHeader.locale")}</th>
                        <th>{t("consent.recordsTableHeader.device")}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((row) => (
                        <tr key={row.cid}>
                          <td>{new Date(row.ts).toLocaleString()}</td>
                          <td className="jf-td--mono">{row.cid}</td>
                          <td className="jf-td--mono" title={row.policyHash}>
                            v{row.policyVersion} · {row.policyHash.slice(0, 8)}
                          </td>
                          <td>
                            {(["necessary", ...OPTIONAL] as Array<OptionalCategory | "necessary">)
                              .filter((category) => row.choices?.[category])
                              .map((category) => categoryLabel(category))
                              .join(", ")}
                          </td>
                          <td>{row.locale || "—"}</td>
                          <td>{row.device}</td>
                          <td>
                            <button
                              type="button"
                              className="jf-btn jf-btn--ghost"
                              onClick={() => erase(row.cid)}
                            >
                              {t("consent.eraseButton")}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BannerPreview({
  design,
  text,
  privacyUrl,
  previewCaption,
}: {
  design: ConsentDesign;
  text: LocalizedText;
  privacyUrl: string;
  previewCaption: string;
}) {
  const c = design.colors;
  const themed = design.useThemeColors;
  const panel: CSSProperties = {
    background: themed ? "var(--jf-surface, #fff)" : c.background,
    color: themed ? "var(--jf-text, #1a1a1a)" : c.text,
    border: `1px solid ${themed ? "var(--jf-border, #e2e8f0)" : c.border}`,
    borderRadius: design.panelRadius || "12px",
    padding: 16,
    width: design.layout === "bar" ? "100%" : `min(${design.width || "460px"}, 100%)`,
    boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
  };
  const btn = (variant: "primary" | "secondary" | "ghost"): CSSProperties => ({
    borderRadius: design.buttonRadius || "8px",
    border: `1px solid ${themed ? "var(--jf-accent, #2563eb)" : c.accent}`,
    padding: "0.5rem 0.9rem",
    fontWeight: 600,
    fontSize: 13,
    background:
      variant === "ghost" ? "transparent" : themed ? "var(--jf-accent, #2563eb)" : c.accent,
    color:
      variant === "secondary"
        ? themed
          ? "var(--jf-accent, #2563eb)"
          : c.accent
        : variant === "ghost"
          ? "inherit"
          : themed
            ? "#fff"
            : c.accentText,
    ...(variant === "secondary" ? { background: "transparent" } : {}),
  });
  const align = design.position.includes("left")
    ? "flex-start"
    : design.position.includes("right")
      ? "flex-end"
      : "center";
  return (
    <div className="jf-field">
      <span className="jf-field__label">{previewCaption}</span>
      <div
        style={{
          background:
            "repeating-linear-gradient(45deg, #f1f5f9, #f1f5f9 10px, #e9eef4 10px, #e9eef4 20px)",
          borderRadius: 8,
          padding: 16,
          display: "flex",
          justifyContent: align,
          alignItems: design.position.startsWith("top") ? "flex-start" : "flex-end",
          minHeight: 150,
        }}
      >
        <div style={panel}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{text.bannerTitle}</div>
          <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 10 }}>
            {text.bannerBody}{" "}
            {privacyUrl && (
              <span style={{ color: themed ? "var(--jf-accent, #2563eb)" : c.accent }}>
                {text.privacyPolicyLabel}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span style={btn("primary")}>{text.acceptAllLabel}</span>
            <span style={btn("secondary")}>{text.rejectAllLabel}</span>
            <span style={btn("ghost")}>{text.preferencesLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
