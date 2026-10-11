import { useCallback, useEffect, useMemo, useState } from "react";
import BlockInspector from "@components/builder/BlockInspector";
import type { BlockCatalogEntry, BlockNode } from "@components/builder/types";
import { uid } from "../../../lib/uid";
import { useT } from "../../../i18n/I18nProvider";

type Position = "left" | "right" | "top";
type Source = "core" | "theme" | "site" | "plugin";

interface AreaSummary {
  key: string;
  label: string;
  description?: string;
  source: Source;
  defaultLayout?: { contentTypes: string[]; position: Position };
  saved: boolean;
  hasDraft: boolean;
}

interface AreaDoc {
  version: 1;
  blocks: BlockNode[];
  locales: Record<string, BlockNode[]>;
  /** Own width in px; null uses the site's sidebar width (Styles → Layout). */
  width: number | null;
}

interface LayoutRule {
  area: string | null;
  position: Position;
}

interface ActiveLanguage {
  code: string;
  nativeName?: string;
}

/** Where a dragged widget comes from: the palette (a new widget) or an area row. */
type DragPayload = { kind: "new"; type: string } | { kind: "move"; area: string; index: number };

const DRAG_MIME = "application/x-jf-widget";
const ALL_LANGUAGES = "";
const DEFAULT_RULE = "__default";
const NO_AREA = "__none";
const WIDTH_MIN = 160;
const WIDTH_MAX = 640;
const AREA_KEY = /^[a-z][a-z0-9-]{0,31}$/;

function emptyDoc(): AreaDoc {
  return { version: 1, blocks: [], locales: {}, width: null };
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 32);
}

/** A new block of `type`, with every schema default filled in. */
function newWidget(entry: BlockCatalogEntry): BlockNode {
  const props: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(entry.schema ?? {})) {
    if (field.default !== undefined) props[key] = field.default;
  }
  return { id: uid(), type: entry.type, version: entry.version ?? 1, props };
}

function readDrag(e: React.DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    return raw ? (JSON.parse(raw) as DragPayload) : null;
  } catch {
    return null;
  }
}

/**
 * Appearance → Widgets: every widget area on one screen, EmDash-style. The
 * palette on the left lists widget blocks (`category: "widgets"`); drag one
 * onto an area, or click it to add it to the area you last worked in. Each
 * widget is a row that expands into its settings. The Layout tab chooses which
 * area each content type shows, and where.
 */
export default function WidgetsPage() {
  const { t } = useT();
  const [tab, setTab] = useState<"areas" | "layout">("areas");
  const [areas, setAreas] = useState<AreaSummary[]>([]);
  const [docs, setDocs] = useState<Record<string, AreaDoc>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [catalog, setCatalog] = useState<BlockCatalogEntry[]>([]);
  const [languages, setLanguages] = useState<ActiveLanguage[]>([]);
  const [locale, setLocale] = useState(ALL_LANGUAGES);
  const [contentTypes, setContentTypes] = useState<Array<{ slug: string; label: string }>>([]);
  const [layout, setLayout] = useState<Record<string, LayoutRule>>({});
  const [activeArea, setActiveArea] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"" | "saved" | "error">("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [draftArea, setDraftArea] = useState({ label: "", key: "", description: "", keyTouched: false });

  const catalogByType = useMemo(() => new Map(catalog.map((entry) => [entry.type, entry])), [catalog]);
  const palette = useMemo(() => catalog.filter((entry) => entry.category === "widgets"), [catalog]);

  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    setStatus("error");
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/widgets");
    if (!res.ok) throw new Error(t("widgets.loadError"));
    const body = (await res.json()) as {
      areas?: AreaSummary[];
      layout?: Record<string, LayoutRule>;
      contentTypes?: Array<{ slug: string; label: string }>;
    };
    const list = body.areas ?? [];
    const loaded = await Promise.all(
      list.map(async (area) => {
        const r = await fetch(`/api/widgets/areas/${encodeURIComponent(area.key)}`);
        const data = (await r.json()) as { doc?: AreaDoc; draft?: AreaDoc | null };
        const doc = data.draft ?? data.doc ?? emptyDoc();
        return [area.key, { ...emptyDoc(), ...doc, width: doc.width ?? null }] as const;
      }),
    );
    setAreas(list);
    setDocs(Object.fromEntries(loaded));
    setDirty(new Set());
    setLayout(body.layout ?? {});
    setContentTypes(body.contentTypes ?? []);
    setActiveArea((current) => (list.some((area) => area.key === current) ? current : (list[0]?.key ?? "")));
  }, [t]);

  useEffect(() => {
    load()
      .catch(fail)
      .finally(() => setLoading(false));
    fetch("/api/blocks")
      .then((r) => r.json())
      .then((data: { blocks?: BlockCatalogEntry[] }) => setCatalog(data.blocks ?? []))
      .catch(() => setCatalog([]));
    fetch("/api/languages/active")
      .then((r) => r.json())
      .then((data: { languages?: ActiveLanguage[] }) => setLanguages(data.languages ?? []))
      .catch(() => setLanguages([]));
  }, [load, fail]);

  /* ----------------------------- area editing ---------------------------- */

  function blocksOf(key: string): BlockNode[] {
    const doc = docs[key] ?? emptyDoc();
    return locale === ALL_LANGUAGES ? doc.blocks : (doc.locales[locale] ?? doc.blocks);
  }

  function setBlocks(key: string, next: BlockNode[]) {
    setDocs((prev) => {
      const doc = prev[key] ?? emptyDoc();
      return {
        ...prev,
        [key]:
          locale === ALL_LANGUAGES
            ? { ...doc, blocks: next }
            : { ...doc, locales: { ...doc.locales, [locale]: next } },
      };
    });
    markDirty(key);
  }

  function markDirty(...keys: string[]) {
    setStatus("");
    setDirty((prev) => new Set([...prev, ...keys]));
  }

  function setWidth(key: string, raw: string) {
    const n = Number(raw);
    setDocs((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? emptyDoc()), width: raw.trim() === "" || !Number.isFinite(n) ? null : Math.round(n) },
    }));
    markDirty(key);
  }

  function resetLocale(key: string) {
    setDocs((prev) => {
      const doc = prev[key] ?? emptyDoc();
      const locales = { ...doc.locales };
      delete locales[locale];
      return { ...prev, [key]: { ...doc, locales } };
    });
    markDirty(key);
  }

  function addWidget(type: string, areaKey: string, index?: number) {
    const entry = catalogByType.get(type);
    if (!entry || !areaKey) return;
    const widget = newWidget(entry);
    const list = [...blocksOf(areaKey)];
    list.splice(index ?? list.length, 0, widget);
    setBlocks(areaKey, list);
    setActiveArea(areaKey);
    setOpen(widget.id);
  }

  function removeWidget(areaKey: string, index: number) {
    const list = [...blocksOf(areaKey)];
    list.splice(index, 1);
    setBlocks(areaKey, list);
  }

  function updateWidget(areaKey: string, index: number, props: Record<string, unknown>) {
    const list = [...blocksOf(areaKey)];
    const current = list[index];
    if (!current) return;
    list[index] = { ...current, props };
    setBlocks(areaKey, list);
  }

  /** Move a row within an area, or from one area to another. */
  function moveWidget(from: { area: string; index: number }, toArea: string, toIndex: number) {
    const source = [...blocksOf(from.area)];
    const [moved] = source.splice(from.index, 1);
    if (!moved) return;
    if (from.area === toArea) {
      source.splice(toIndex > from.index ? toIndex - 1 : toIndex, 0, moved);
      setBlocks(toArea, source);
      return;
    }
    const target = [...blocksOf(toArea)];
    target.splice(toIndex, 0, moved);
    setBlocks(from.area, source);
    setBlocks(toArea, target);
  }

  function onDrop(e: React.DragEvent, areaKey: string, index: number) {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const payload = readDrag(e);
    if (!payload) return;
    if (payload.kind === "new") addWidget(payload.type, areaKey, index);
    else moveWidget(payload, areaKey, index);
  }

  function allowDrop(e: React.DragEvent, target: string) {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    if (dropTarget !== target) setDropTarget(target);
  }

  /* ------------------------------ saving --------------------------------- */

  async function save(publish: boolean) {
    const keys = areas
      .map((area) => area.key)
      .filter((key) => dirty.has(key) || (publish && areas.find((area) => area.key === key)?.hasDraft));
    if (!keys.length) return;
    setSaving(true);
    setStatus("");
    setError("");
    try {
      for (const key of keys) {
        const doc = docs[key] ?? emptyDoc();
        const res = await fetch(`/api/widgets/areas/${encodeURIComponent(key)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blocks: doc.blocks,
            locales: doc.locales,
            width: doc.width === null ? null : Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, doc.width)),
            draft: !publish,
          }),
        });
        const body = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? t("widgets.saveError"));
      }
      setAreas((prev) =>
        prev.map((area) =>
          keys.includes(area.key) ? { ...area, saved: area.saved || publish, hasDraft: !publish } : area,
        ),
      );
      setDirty(new Set());
      setStatus("saved");
      setTimeout(() => setStatus(""), 2000);
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  }

  async function createArea() {
    const key = draftArea.key || slugify(draftArea.label);
    if (!draftArea.label.trim() || !AREA_KEY.test(key)) {
      fail(new Error(t("widgets.areaKeyHint")));
      return;
    }
    try {
      const res = await fetch("/api/widgets/areas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, label: draftArea.label.trim(), description: draftArea.description.trim() }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? t("widgets.saveError"));
      setCreating(false);
      setDraftArea({ label: "", key: "", description: "", keyTouched: false });
      setAreas((prev) => [...prev.filter((area) => area.source !== "plugin"), {
        key,
        label: draftArea.label.trim(),
        ...(draftArea.description.trim() ? { description: draftArea.description.trim() } : {}),
        source: "site" as const,
        saved: false,
        hasDraft: false,
      }, ...prev.filter((area) => area.source === "plugin")]);
      setDocs((prev) => ({ ...prev, [key]: emptyDoc() }));
      setActiveArea(key);
    } catch (e) {
      fail(e);
    }
  }

  async function deleteArea(area: AreaSummary) {
    if (!window.confirm(t("widgets.deleteAreaConfirm", { name: area.label }))) return;
    try {
      const res = await fetch(`/api/widgets/areas/${encodeURIComponent(area.key)}`, { method: "DELETE" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? t("widgets.saveError"));
      await load();
    } catch (e) {
      fail(e);
    }
  }

  /* ------------------------------ layout --------------------------------- */

  function defaultFor(type: string): { area: AreaSummary; position: Position } | null {
    const match = areas.find((row) => row.defaultLayout?.contentTypes.includes(type));
    return match?.defaultLayout ? { area: match, position: match.defaultLayout.position } : null;
  }

  function setRuleArea(type: string, value: string) {
    setStatus("");
    setLayout((prev) => {
      const next = { ...prev };
      if (value === DEFAULT_RULE) {
        delete next[type];
        return next;
      }
      const position = prev[type]?.position ?? defaultFor(type)?.position ?? "right";
      next[type] = { area: value === NO_AREA ? null : value, position };
      return next;
    });
  }

  function setRulePosition(type: string, position: Position) {
    setStatus("");
    setLayout((prev) => (prev[type] ? { ...prev, [type]: { ...prev[type], position } } : prev));
  }

  async function saveLayout() {
    setSaving(true);
    setStatus("");
    try {
      const res = await fetch("/api/widgets/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout }),
      });
      const body = (await res.json()) as { error?: string; layout?: Record<string, LayoutRule> };
      if (!res.ok) throw new Error(body.error ?? t("widgets.saveError"));
      setLayout(body.layout ?? {});
      setStatus("saved");
      setTimeout(() => setStatus(""), 2000);
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  }

  /* ------------------------------- view ---------------------------------- */

  if (loading) return <div className="jf-center">{t("widgets.loading")}</div>;

  const pending = dirty.size > 0 || areas.some((area) => area.hasDraft);
  const sourceLabel: Record<Source, string> = {
    core: t("widgets.sourceCore"),
    theme: t("widgets.sourceTheme"),
    site: t("widgets.sourceSite"),
    plugin: t("widgets.sourcePlugin"),
  };

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("nav.widgets")}</h1>
          <p>{t("widgets.pageIntro")}</p>
        </div>
        <div className="jf-pagehead__actions">
          {status === "saved" && <span className="jf-field__hint" style={{ color: "var(--jf-success)" }}>✓ {t("common.saved")}</span>}
          {tab === "areas" ? (
            <>
              <button type="button" className="jf-btn jf-btn--ghost" onClick={() => setCreating(true)}>
                + {t("widgets.addArea")}
              </button>
              <button type="button" className="jf-btn jf-btn--ghost" disabled={saving || dirty.size === 0} onClick={() => void save(false)}>
                {saving ? t("common.saving") : t("content.saveDraft")}
              </button>
              <button type="button" className="jf-btn jf-btn--primary" disabled={saving || !pending} onClick={() => void save(true)}>
                {t("content.publish")}
              </button>
            </>
          ) : (
            <button type="button" className="jf-btn jf-btn--primary" disabled={saving} onClick={() => void saveLayout()}>
              {saving ? t("common.saving") : t("widgets.saveLayout")}
            </button>
          )}
        </div>
      </header>

      {status === "error" && <div className="jf-alert jf-alert--error">{error}</div>}

      <div className="jf-tabs" role="tablist" style={{ display: "flex", gap: "0.4rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        {(["areas", "layout"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`jf-btn jf-btn--sm ${tab === key ? "jf-btn--primary" : "jf-btn--ghost"}`}
            onClick={() => setTab(key)}
          >
            {key === "areas" ? t("widgets.tabAreas") : t("widgets.layoutHeading")}
          </button>
        ))}
        {tab === "areas" && languages.length > 1 && (
          <label style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span className="jf-field__label" style={{ margin: 0 }}>{t("widgets.language")}</span>
            <select className="jf-input" value={locale} onChange={(e) => { setLocale(e.target.value); setOpen(null); }}>
              <option value={ALL_LANGUAGES}>{t("widgets.allLanguages")}</option>
              {languages.map((lang) => (
                <option key={lang.code} value={lang.code}>{lang.nativeName || lang.code}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {creating && (
        <div className="jf-card" style={{ marginBottom: "1rem" }}>
          <div className="jf-card__body jf-stack">
            <h2 className="jf-card__title">{t("widgets.addArea")}</h2>
            <label className="jf-field">
              <span className="jf-field__label">{t("widgets.areaName")}</span>
              <input
                className="jf-input"
                value={draftArea.label}
                autoFocus
                onChange={(e) => {
                  const label = e.target.value;
                  setDraftArea((prev) => ({ ...prev, label, key: prev.keyTouched ? prev.key : slugify(label) }));
                }}
              />
            </label>
            <label className="jf-field">
              <span className="jf-field__label">{t("widgets.areaKey")}</span>
              <input
                className="jf-input"
                value={draftArea.key}
                onChange={(e) => setDraftArea((prev) => ({ ...prev, key: e.target.value.toLowerCase(), keyTouched: true }))}
              />
              <span className="jf-field__hint">{t("widgets.areaKeyHint")}</span>
            </label>
            <label className="jf-field">
              <span className="jf-field__label">{t("widgets.areaDescription")}</span>
              <input
                className="jf-input"
                value={draftArea.description}
                onChange={(e) => setDraftArea((prev) => ({ ...prev, description: e.target.value }))}
              />
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" className="jf-btn jf-btn--primary" onClick={() => void createArea()}>{t("common.add")}</button>
              <button type="button" className="jf-btn jf-btn--ghost" onClick={() => setCreating(false)}>{t("common.cancel")}</button>
            </div>
          </div>
        </div>
      )}

      {tab === "areas" ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(14rem, 22rem) minmax(0, 1fr)", gap: "1.25rem", alignItems: "start" }}>
          <section className="jf-card" style={{ position: "sticky", top: "1rem" }}>
            <div className="jf-card__body jf-stack">
              <h2 className="jf-card__title">{t("widgets.availableWidgets")}</h2>
              <p className="jf-field__hint" style={{ marginTop: 0 }}>{t("widgets.availableHint")}</p>
              {palette.length === 0 && <p className="jf-field__hint">{t("widgets.noWidgets")}</p>}
              {palette.map((entry) => (
                <button
                  key={entry.type}
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: "new", type: entry.type } satisfies DragPayload));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => addWidget(entry.type, activeArea || areas[0]?.key || "")}
                  title={t("widgets.addToArea", { area: areas.find((area) => area.key === activeArea)?.label ?? "" })}
                  style={{
                    textAlign: "left",
                    padding: "0.75rem 0.9rem",
                    border: "1px solid var(--jf-border)",
                    borderRadius: "var(--jf-radius)",
                    background: "var(--jf-surface)",
                    cursor: "grab",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.2rem",
                  }}
                >
                  <strong>{entry.icon ? `${entry.icon} ` : ""}{entry.title}</strong>
                  {entry.description && <span className="jf-field__hint" style={{ margin: 0 }}>{entry.description}</span>}
                </button>
              ))}
            </div>
          </section>

          <div className="jf-stack">
            {areas.length === 0 && <div className="jf-card"><div className="jf-card__body">{t("widgets.noAreas")}</div></div>}
            {areas.map((area) => {
              const blocks = blocksOf(area.key);
              const doc = docs[area.key] ?? emptyDoc();
              const overridden = locale !== ALL_LANGUAGES && Boolean(doc.locales[locale]);
              const endTarget = `${area.key}:end`;
              return (
                <section
                  key={area.key}
                  className="jf-card"
                  onFocusCapture={() => setActiveArea(area.key)}
                  onMouseDown={() => setActiveArea(area.key)}
                  style={activeArea === area.key ? { outline: "2px solid var(--jf-accent)", outlineOffset: "-1px" } : undefined}
                >
                  <div className="jf-card__head" style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h2 className="jf-card__title" style={{ display: "flex", gap: "0.5rem", alignItems: "baseline", flexWrap: "wrap" }}>
                        {area.label}
                        <span className="jf-field__hint" style={{ margin: 0, fontWeight: 400 }}>{sourceLabel[area.source]}</span>
                        {(dirty.has(area.key) || area.hasDraft) && (
                          <span className="jf-field__hint" style={{ margin: 0, fontWeight: 400 }}>{t("widgets.draftSuffix")}</span>
                        )}
                      </h2>
                      {area.description && <p className="jf-field__hint" style={{ margin: "0.2rem 0 0" }}>{area.description}</p>}
                      {!area.saved && !dirty.has(area.key) && blocks.length > 0 && (
                        <p className="jf-field__hint" style={{ margin: "0.2rem 0 0" }}>{t("widgets.fromDefaultHint")}</p>
                      )}
                      {locale !== ALL_LANGUAGES && (
                        <p className="jf-field__hint" style={{ margin: "0.2rem 0 0" }}>
                          {overridden ? t("widgets.overriddenHint") : t("widgets.inheritedHint")}{" "}
                          {overridden && (
                            <button type="button" className="jf-linkbtn" onClick={() => resetLocale(area.key)}>
                              {t("widgets.resetToBase")}
                            </button>
                          )}
                        </p>
                      )}
                    </div>
                    <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", width: "7.5rem" }}>
                      <span className="jf-field__hint" style={{ margin: 0 }}>{t("widgets.widthLabel")}</span>
                      <input
                        className="jf-input"
                        type="number"
                        min={WIDTH_MIN}
                        max={WIDTH_MAX}
                        step={8}
                        placeholder={t("widgets.widthPlaceholder")}
                        title={t("widgets.widthHint", { min: WIDTH_MIN, max: WIDTH_MAX })}
                        value={doc.width ?? ""}
                        onChange={(e) => setWidth(area.key, e.target.value)}
                      />
                    </label>
                    {area.source === "site" && (
                      <button
                        type="button"
                        className="jf-btn jf-btn--sm jf-btn--ghost"
                        aria-label={t("widgets.deleteArea", { name: area.label })}
                        title={t("widgets.deleteArea", { name: area.label })}
                        onClick={() => void deleteArea(area)}
                      >
                        🗑
                      </button>
                    )}
                  </div>
                  <div
                    className="jf-card__body"
                    style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
                    onDragOver={(e) => allowDrop(e, endTarget)}
                    onDragLeave={() => setDropTarget((current) => (current === endTarget ? null : current))}
                    onDrop={(e) => onDrop(e, area.key, blocks.length)}
                  >
                    {blocks.map((block, index) => {
                      const entry = catalogByType.get(block.type);
                      const rowTarget = `${area.key}:${index}`;
                      const titleProp = typeof block.props.title === "string" ? block.props.title.trim() : "";
                      const expanded = open === block.id;
                      return (
                        <div
                          key={block.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: "move", area: area.key, index } satisfies DragPayload));
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragOver={(e) => allowDrop(e, rowTarget)}
                          onDrop={(e) => onDrop(e, area.key, index)}
                          style={{
                            border: "1px solid var(--jf-border)",
                            borderTop: dropTarget === rowTarget ? "3px solid var(--jf-accent)" : "1px solid var(--jf-border)",
                            borderRadius: "var(--jf-radius)",
                            background: "var(--jf-bg)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.6rem 0.75rem" }}>
                            <span aria-hidden="true" style={{ cursor: "grab", color: "var(--jf-text-3)" }}>⠿</span>
                            <button
                              type="button"
                              className="jf-linkbtn"
                              aria-expanded={expanded}
                              onClick={() => setOpen(expanded ? null : block.id)}
                              style={{ display: "flex", gap: "0.5rem", alignItems: "baseline", flex: 1, minWidth: 0, textAlign: "left" }}
                            >
                              <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
                              <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {titleProp || entry?.title || block.type}
                              </strong>
                              <span className="jf-field__hint" style={{ margin: 0 }}>
                                ({entry?.title && titleProp ? entry.title : entry ? t("widgets.widgetKind") : block.type})
                              </span>
                            </button>
                            <button
                              type="button"
                              className="jf-btn jf-btn--sm jf-btn--ghost"
                              aria-label={t("widgets.removeWidget")}
                              title={t("widgets.removeWidget")}
                              onClick={() => removeWidget(area.key, index)}
                            >
                              🗑
                            </button>
                          </div>
                          {expanded && (
                            <div style={{ padding: "0 0.9rem 0.9rem", borderTop: "1px solid var(--jf-border)" }}>
                              <div style={{ paddingTop: "0.75rem" }}>
                                <BlockInspector
                                  compact
                                  block={block}
                                  catalogEntry={entry}
                                  onChange={(props) => updateWidget(area.key, index, props)}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div
                      style={{
                        border: `2px dashed ${dropTarget === endTarget ? "var(--jf-accent)" : "var(--jf-border)"}`,
                        borderRadius: "var(--jf-radius)",
                        padding: blocks.length ? "0.5rem" : "1.25rem",
                        textAlign: "center",
                        color: "var(--jf-text-3)",
                        fontSize: "0.85rem",
                      }}
                    >
                      {blocks.length ? t("widgets.dropHere") : t("widgets.emptyArea")}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <section className="jf-card">
          <div className="jf-card__body jf-stack">
            <p className="jf-field__hint" style={{ marginTop: 0 }}>{t("widgets.layoutHint")}</p>
            {contentTypes.map((type) => {
              const rule = layout[type.slug];
              const fallback = defaultFor(type.slug);
              const value = !rule ? DEFAULT_RULE : (rule.area ?? NO_AREA);
              return (
                <div key={type.slug} style={{ display: "grid", gridTemplateColumns: "minmax(8rem, 12rem) minmax(0, 1fr) 9rem", gap: "0.6rem", alignItems: "center" }}>
                  <label className="jf-field__label" htmlFor={`jf-widget-type-${type.slug}`} style={{ margin: 0 }}>{type.label}</label>
                  <select
                    id={`jf-widget-type-${type.slug}`}
                    className="jf-input"
                    value={value}
                    onChange={(e) => setRuleArea(type.slug, e.target.value)}
                  >
                    <option value={DEFAULT_RULE}>
                      {fallback
                        ? t("widgets.defaultArea", { area: fallback.area.label, position: t(`widgets.position.${fallback.position}`) })
                        : t("widgets.defaultNone")}
                    </option>
                    <option value={NO_AREA}>{t("widgets.noArea")}</option>
                    {areas.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
                  </select>
                  <select
                    className="jf-input"
                    aria-label={t("widgets.positionLabel", { type: type.label })}
                    value={rule?.position ?? fallback?.position ?? "right"}
                    disabled={!rule || rule.area === null}
                    onChange={(e) => setRulePosition(type.slug, e.target.value as Position)}
                  >
                    {(["left", "right", "top"] as const).map((position) => (
                      <option key={position} value={position}>{t(`widgets.position.${position}`)}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
