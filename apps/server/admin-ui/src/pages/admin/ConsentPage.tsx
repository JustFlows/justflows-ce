import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useSessionRole } from "@components/SessionProvider";

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

const EMPTY_TEXT: LocalizedText = {
  bannerTitle: "We value your privacy",
  bannerBody:
    "We use cookies to run this site and, with your consent, to measure traffic and personalise content.",
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
      description: "Remembers choices such as language or region.",
    },
    analytics: { name: "Analytics", description: "Helps us understand how visitors use the site." },
    marketing: {
      name: "Marketing",
      description: "Used for relevant content and campaign measurement.",
    },
  },
};

const TEXT_FIELDS: Array<[keyof LocalizedText, string, boolean]> = [
  ["bannerTitle", "Banner title", false],
  ["bannerBody", "Banner body", true],
  ["privacyPolicyLabel", "Privacy-policy link label", false],
  ["acceptAllLabel", "Accept-all button", false],
  ["rejectAllLabel", "Reject button", false],
  ["saveLabel", "Save button", false],
  ["preferencesLabel", "Preferences button", false],
  ["necessaryName", "“Necessary” category name", false],
  ["necessaryDescription", "“Necessary” category description", true],
  ["embedNote", "Blocked-embed note", true],
  ["embedUnlockLabel", "Embed unlock button", false],
];

const COLOR_FIELDS: Array<[keyof ConsentDesign["colors"], string]> = [
  ["background", "Background"],
  ["text", "Text"],
  ["accent", "Accent (buttons, links)"],
  ["accentText", "Accent text"],
  ["border", "Border"],
];

export default function ConsentPage() {
  const canManage = useSessionRole() === "administrator";

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
            : [{ code: cfg.defaultLocale || "en", nativeName: "Default", isDefault: true }];
        // Make sure every site language has an editable translation block.
        const translations = { ...cfg.translations };
        const seed = translations[cfg.defaultLocale] ?? EMPTY_TEXT;
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
      const current = c.translations[activeLocale] ?? EMPTY_TEXT;
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
      const current = c.translations[activeLocale] ?? EMPTY_TEXT;
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
        if (!r.ok) throw new Error(body.error ?? "Save failed");
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
    if (!window.confirm(`Erase the consent record for ${cid}? This cannot be undone.`)) return;
    fetch(`${BASE}/records/${encodeURIComponent(cid)}`, { method: "DELETE" })
      .then((r) => {
        if (!r.ok && r.status !== 204) throw new Error("Erase failed");
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
        if (!r.ok) throw new Error(body.error ?? "Save failed");
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

  const text = config?.translations[activeLocale] ?? EMPTY_TEXT;

  if (!canManage) {
    return (
      <div className="jf-page">
        <div className="jf-alert jf-alert--error" role="alert">
          Cookie Consent settings are available to administrators only.
        </div>
      </div>
    );
  }

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>Cookie Consent</h1>
          <p>
            First-party consent banner, preference center, and script/embed gating. Non-essential
            scripts and embeds stay blocked until their category is accepted.
          </p>
        </div>
        <a className="jf-btn jf-btn--ghost" href={`${BASE}/records.csv`}>
          Export records (CSV)
        </a>
      </header>

      {error && (
        <div className="jf-alert jf-alert--error" role="alert">
          {error}
        </div>
      )}
      {saved && <div className="jf-alert">Settings saved.</div>}

      {loading || !config ? (
        <div className="jf-card">
          <div className="jf-card__body">Loading…</div>
        </div>
      ) : (
        <div className="jf-stack">
          {/* ── Behaviour ─────────────────────────────────────────────── */}
          <div className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">Behaviour</h2>
            </div>
            <div className="jf-card__body jf-stack">
              <label className="jf-checkrow">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => set("enabled", e.target.checked)}
                />
                <span>Show the consent banner on the public site</span>
              </label>

              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jfc-mode">
                  Display mode
                </label>
                <select
                  id="jfc-mode"
                  className="jf-input"
                  value={config.displayMode}
                  onChange={(e) =>
                    set("displayMode", e.target.value as ConsentConfig["displayMode"])
                  }
                >
                  <option value="always">Always show</option>
                  <option value="eu">EU / EEA visitors only (best-effort, timezone based)</option>
                  <option value="off">Off</option>
                </select>
                <p className="jf-field__hint">
                  Geo detection is best-effort and runs in the visitor&rsquo;s browser — no IP
                  lookup, no third party.
                </p>
              </div>

              <label className="jf-checkrow">
                <input
                  type="checkbox"
                  checked={config.logConsent}
                  onChange={(e) => set("logConsent", e.target.checked)}
                />
                <span>
                  Store an audit record for each consent decision
                  <span className="jf-field__hint" style={{ display: "block", marginTop: 2 }}>
                    Off: the banner still enforces choices, but no rows are written to the database
                    and no beacon is sent. Turn off if you don&rsquo;t need the audit log.
                  </span>
                </span>
              </label>

              <div className="jf-grid jf-grid--2">
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jfc-pv">
                    Policy version
                  </label>
                  <input
                    id="jfc-pv"
                    className="jf-input"
                    value={config.policyVersion}
                    onChange={(e) => set("policyVersion", e.target.value)}
                  />
                  <p className="jf-field__hint">
                    Bump when the policy changes — prior consent is invalidated and the banner
                    re-appears. Editing translations does not.
                  </p>
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jfc-purl">
                    Privacy policy URL
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
                  Re-open selector
                </label>
                <input
                  id="jfc-reopen"
                  className="jf-input"
                  value={config.reopenSelector}
                  onChange={(e) => set("reopenSelector", e.target.value)}
                />
                <p className="jf-field__hint">
                  Clicks on elements matching this CSS selector re-open the preference center.
                </p>
              </div>
            </div>
          </div>

          {/* ── Categories offered ────────────────────────────────────── */}
          <div className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">Categories</h2>
            </div>
            <div className="jf-card__body jf-stack">
              <p className="jf-meta">
                <strong>Strictly necessary</strong> is always on. Choose which optional categories
                visitors can consent to.
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
                  <span style={{ textTransform: "capitalize" }}>{category}</span>
                </label>
              ))}
            </div>
          </div>

          {/* ── Text (per language) ───────────────────────────────────── */}
          <div className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">Text</h2>
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

              {TEXT_FIELDS.map(([field, label, multiline]) => (
                <div className="jf-field" key={field}>
                  <label className="jf-field__label" htmlFor={`jfc-t-${field}`}>
                    {label}
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
                      <span style={{ textTransform: "capitalize" }}>{category}</span> name
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
                      <span style={{ textTransform: "capitalize" }}>{category}</span> description
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
              <h2 className="jf-card__title">Design &amp; placement</h2>
            </div>
            <div className="jf-card__body jf-stack">
              <div className="jf-grid jf-grid--2">
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jfc-layout">
                    Layout
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
                          ? "Bar (full-width strip)"
                          : l === "box"
                            ? "Box (floating card)"
                            : "Modal (centered, blocks the page)"}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jfc-pos">
                    Position
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
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="jf-grid jf-grid--2">
                <div className="jf-field">
                  <label className="jf-field__label" htmlFor="jfc-panelr">
                    Panel corner radius
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
                    Button corner radius
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
                    Panel width (box / modal)
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
                    Modal backdrop
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
                <span>Use the active theme&rsquo;s colours (recommended)</span>
              </label>

              {!config.design.useThemeColors && (
                <div className="jf-grid jf-grid--2">
                  {COLOR_FIELDS.map(([key, label]) => (
                    <div className="jf-field" key={key}>
                      <label className="jf-field__label" htmlFor={`jfc-c-${key}`}>
                        {label}
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
              />
            </div>
          </div>

          {/* ── Script & embed gating ─────────────────────────────────── */}
          <div className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">Script &amp; embed gating</h2>
            </div>
            <div className="jf-card__body jf-stack">
              <label className="jf-checkrow">
                <input
                  type="checkbox"
                  checked={config.gateEmbeds}
                  onChange={(e) => set("gateEmbeds", e.target.checked)}
                />
                <span>
                  Replace off-site embeds in page content with an unlockable placeholder until
                  Marketing is accepted
                </span>
              </label>

              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jfc-as">
                  Analytics head snippet
                </label>
                <textarea
                  id="jfc-as"
                  className="jf-input"
                  rows={3}
                  placeholder="<script>…</script> — runs only after the visitor accepts Analytics"
                  value={config.analyticsSnippet}
                  onChange={(e) => set("analyticsSnippet", e.target.value)}
                />
                <p className="jf-field__hint">
                  The Google Tag configured in the Analytics plugin is gated automatically.
                </p>
              </div>

              <div className="jf-field">
                <label className="jf-field__label" htmlFor="jfc-ms">
                  Marketing head snippet
                </label>
                <textarea
                  id="jfc-ms"
                  className="jf-input"
                  rows={3}
                  placeholder="<script>…</script> — runs only after the visitor accepts Marketing"
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
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>

          {/* ── Cookie declarations ──────────────────────────────────── */}
          <div className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">Cookie declarations</h2>
            </div>
            <div className="jf-card__body jf-stack">
              <p className="jf-meta">
                Every cookie the platform and each active plugin has registered via the{" "}
                <code>ctx.cookies</code> hook. The consent banner discloses these per category and,
                when a visitor withdraws a category, the runtime expires its cookies. Re-classify a
                cookie below to override the category its developer chose. <code>necessary</code>{" "}
                cookies are always allowed and cannot be blocked.
              </p>
              {cookies.length === 0 ? (
                <p className="jf-meta">
                  No cookies registered yet. Core cookies appear once the site is running; plugin
                  cookies appear when the plugin is active.
                </p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="jf-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Set by</th>
                        <th>Purpose</th>
                        <th>Duration</th>
                        <th>Declared</th>
                        <th>Category (override)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cookies.map((cookie) => (
                        <tr key={cookie.name}>
                          <td className="jf-td--mono">{cookie.name}</td>
                          <td>{cookie.provider || cookie.declaredBy}</td>
                          <td>{cookie.purpose}</td>
                          <td>{cookie.duration || "—"}</td>
                          <td style={{ textTransform: "capitalize" }}>{cookie.category}</td>
                          <td>
                            <select
                              className="jf-input"
                              value={overrides[cookie.name] ?? cookie.category}
                              onChange={(e) => setOverride(cookie.name, e.target.value)}
                            >
                              {ALL_CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                  {c === cookie.category ? " (declared)" : ""}
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
                  {savingOverrides ? "Saving…" : "Save category overrides"}
                </button>
              </div>
            </div>
          </div>

          {/* ── Records ───────────────────────────────────────────────── */}
          <div className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">Consent records</h2>
            </div>
            <div className="jf-card__body jf-stack">
              {!config.logConsent && (
                <div className="jf-alert">
                  Audit logging is off — no new records are written. Existing rows below are kept
                  until erased.
                </div>
              )}
              <p className="jf-meta">
                {summary.total} record{summary.total === 1 ? "" : "s"} — analytics accepted by{" "}
                {summary.analytics}, marketing by {summary.marketing}, preferences by{" "}
                {summary.preferences}. Each row is bound to the policy version and hash in effect
                when it was recorded.
              </p>
              {records.length === 0 ? (
                <p className="jf-meta">
                  Nothing recorded yet. Visit the public site in a fresh session and make a choice.
                </p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="jf-table">
                    <thead>
                      <tr>
                        <th>Recorded</th>
                        <th>Client ID</th>
                        <th>Policy</th>
                        <th>Choices</th>
                        <th>Locale</th>
                        <th>Device</th>
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
                            {["necessary", ...OPTIONAL]
                              .filter((category) => row.choices?.[category])
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
                              Erase
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
}: {
  design: ConsentDesign;
  text: LocalizedText;
  privacyUrl: string;
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
      <span className="jf-field__label">
        Preview — {design.layout} · {design.position}
      </span>
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
