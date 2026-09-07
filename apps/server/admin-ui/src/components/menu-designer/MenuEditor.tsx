import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/I18nProvider";
import { uid } from "../../lib/uid";
import MenuTreeView from "./MenuTreeView";
import MenuItemDrawer from "./MenuItemDrawer";
import MenuDesignPanel, { type MenuDesign, type MenuDesignPreset } from "./MenuDesignPanel";
import MenuPreviewPane, { type MenuPreviewHandle } from "./MenuPreviewPane";
import { useBuilderHistory } from "../builder/useBuilderHistory";
import { findItemPath, getItemAtPath, type MenuItem } from "./menu-tree";

export interface EditableMenu {
  id: string;
  slug: string;
  name: string;
  items: MenuItem[];
  design?: MenuDesign;
}

export interface ContentTypeOption {
  slug: string;
  label: string;
}

export interface ContentOption {
  id: string;
  title: string;
  slug: string;
  type: string;
  locale: string;
}

export const DEFAULT_MENU_DESIGN: MenuDesign = {
  layout: "horizontal",
  activation: "hover",
  breakpoint: 768,
  mobilePattern: "drawer-right",
  mobileMotion: "slide",
  mobileMotionMs: 240,
  alignment: "start",
  maxDepth: 3,
  maxItemsPerLevel: 20,
  presetId: "",
};

const DRAFT_SAVE_DEBOUNCE_MS = 700;

function cloneItems(items: MenuItem[]): MenuItem[] {
  return items.map((item) => ({ ...item, children: item.children ? cloneItems(item.children) : undefined }));
}

interface MenuEditorProps {
  menu: EditableMenu;
  canManage: boolean;
  contentTypes: ContentTypeOption[];
  contentByType: Record<string, ContentOption[]>;
  activeLocales: string[];
  designPresets: MenuDesignPreset[];
  onPublished: (menu: EditableMenu) => void;
}

/**
 * Everything scoped to editing ONE menu, remounted (via a `key={menu.slug}` from the
 * caller) whenever the selected menu changes — undo/redo history and drafts must never
 * bleed from one menu into another, and a full remount is the simplest way to guarantee
 * that rather than teaching `useBuilderHistory` a reset it has no other caller for.
 */
export default function MenuEditor({
  menu,
  canManage,
  contentTypes,
  contentByType,
  activeLocales,
  designPresets,
  onPublished,
}: MenuEditorProps) {
  const { t } = useT();
  const [items, setItems] = useState<MenuItem[]>(() => cloneItems(menu.items));
  const [design, setDesign] = useState<MenuDesign>(() => ({ ...DEFAULT_MENU_DESIGN, ...(menu.design ?? {}) }));
  const [menuName, setMenuName] = useState(menu.name);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [addTab, setAddTab] = useState<string>("page");
  const [selectedContentIds, setSelectedContentIds] = useState<Set<string>>(new Set());
  const [customLabel, setCustomLabel] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [customTarget, setCustomTarget] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publishedRef = useRef({ items: cloneItems(menu.items), design: { ...DEFAULT_MENU_DESIGN, ...(menu.design ?? {}) } });
  const previewRef = useRef<MenuPreviewHandle>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    // Skip the mount-time write: `items`/`design` above are already this menu's
    // published state, so there is nothing to draft-save yet.
    const t = setTimeout(() => { hydrated.current = true; }, 0);
    return () => clearTimeout(t);
  }, []);

  const history = useBuilderHistory<{ items: MenuItem[]; design: MenuDesign }>(
    { items, design },
    (restored) => {
      setItems(restored.items);
      setDesign(restored.design);
    },
  );

  function commit(nextItems: MenuItem[], nextDesign: MenuDesign) {
    history.record({ items: nextItems, design: nextDesign });
    setItems(nextItems);
    setDesign(nextDesign);
    setSaved(false);
  }

  // Autosave every edit as a draft so the preview iframe (a real `?preview=1`
  // render) always reflects the working copy, exactly like the theme
  // customizer already does for style edits.
  useEffect(() => {
    if (!canManage || !hydrated.current) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      void (async () => {
        try {
          await fetch(`/api/menus/${encodeURIComponent(menu.slug)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: menuName, items, design, draft: true }),
          });
          previewRef.current?.reload();
        } catch {
          // A failed draft save is not fatal — the next edit tries again, and
          // Publish surfaces a real error if the problem persists.
        }
      })();
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, design, menuName]);

  const dirty =
    JSON.stringify(items) !== JSON.stringify(publishedRef.current.items) ||
    JSON.stringify(design) !== JSON.stringify(publishedRef.current.design) ||
    menuName !== menu.name;

  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  async function publishMenu() {
    setPublishing(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`/api/menus/${encodeURIComponent(menu.slug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: menuName, items, design, draft: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      const nextItems = cloneItems(data.menu.items ?? []);
      const nextDesign: MenuDesign = { ...DEFAULT_MENU_DESIGN, ...(data.menu.design ?? {}) };
      setItems(nextItems);
      setDesign(nextDesign);
      setMenuName(data.menu.name);
      publishedRef.current = { items: nextItems, design: nextDesign };
      setSaved(true);
      previewRef.current?.reload();
      onPublished({ ...menu, name: data.menu.name, items: nextItems, design: nextDesign });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishing(false);
    }
  }

  function toggleContentSelection(id: string) {
    setSelectedContentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addSelectedContent(type: string) {
    const source = contentByType[type] ?? [];
    const toAdd = source.filter((c) => selectedContentIds.has(c.id));
    if (!toAdd.length) return;
    const newItems: MenuItem[] = toAdd.map((c) => ({ id: uid(), label: c.title, type, contentId: c.id, url: `/${c.slug}` }));
    commit([...items, ...newItems], design);
    setSelectedContentIds(new Set());
    if (newItems.length === 1) setSelectedItemId(newItems[0]!.id);
  }

  function addCustomLink() {
    if (!customLabel.trim() || !customUrl.trim()) return;
    const item: MenuItem = {
      id: uid(),
      label: customLabel.trim(),
      type: "custom",
      url: customUrl.trim(),
      ...(customTarget ? { target: "_blank" as const } : {}),
    };
    commit([...items, item], design);
    setCustomLabel("");
    setCustomUrl("");
    setCustomTarget(false);
    setSelectedItemId(item.id);
  }

  function contentSlugFor(item: MenuItem): string | undefined {
    if (!item.contentId) return undefined;
    for (const list of Object.values(contentByType)) {
      const found = list.find((row) => row.id === item.contentId);
      if (found) return found.slug;
    }
    return undefined;
  }

  function typeLabel(slug: string): string {
    if (slug === "custom") return t("menus.type.custom");
    const key = `menus.type.${slug}`;
    const translated = t(key);
    if (translated !== key) return translated;
    return contentTypes.find((type) => type.slug === slug)?.label ?? slug;
  }

  function tabLabel(slug: string): string {
    if (slug === "page") return t("menus.tab.pages");
    if (slug === "post") return t("menus.tab.posts");
    const key = `menus.tab.${slug}`;
    const translated = t(key);
    if (translated !== key) return translated;
    return contentTypes.find((type) => type.slug === slug)?.label ?? slug;
  }

  const selectedPath = selectedItemId ? findItemPath(items, selectedItemId) : null;
  const selectedItem = selectedPath ? getItemAtPath(items, selectedPath) : null;
  const selectedIsTopLevel = selectedPath?.length === 1;

  return (
    <>
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("menus.title")}</h1>
          <p>{t("menus.subtitle")}</p>
        </div>
        <div className="jf-pagehead__actions">
          {canManage && (
            <button className="jf-btn jf-btn--primary" onClick={publishMenu} disabled={publishing}>
              {publishing ? t("common.saving") : t("menus.publish")}
            </button>
          )}
        </div>
      </header>

      {error && <div className="jf-alert jf-alert--error" role="alert">{error}</div>}
      {saved && <div className="jf-alert jf-alert--success">{t("common.saved")}</div>}
      {canManage && dirty && !saved && (
        <div className="jf-alert" role="status">
          {t("menus.unpublishedNotice")}
        </div>
      )}

      <div className="jf-split--wide">
        <div className="jf-stack jf-stack--lg">
          {canManage && (
            <div className="jf-card">
              <div className="jf-card__head">
                <h2 className="jf-card__title">{t("menus.addItems")}</h2>
              </div>
              <div className="jf-card__body jf-stack">
                <div className="jf-filterbar">
                  {contentTypes.map((type) => (
                    <button
                      key={type.slug}
                      className="jf-chip"
                      aria-pressed={addTab === type.slug}
                      onClick={() => {
                        setAddTab(type.slug);
                        setSelectedContentIds(new Set());
                      }}
                    >
                      {tabLabel(type.slug)}
                    </button>
                  ))}
                  <button
                    className="jf-chip"
                    aria-pressed={addTab === "custom"}
                    onClick={() => {
                      setAddTab("custom");
                      setSelectedContentIds(new Set());
                    }}
                  >
                    {t("menus.tab.custom")}
                  </button>
                </div>

                {addTab !== "custom" && (
                  <>
                    <div className="jf-scrolllist">
                      {(contentByType[addTab] ?? []).length === 0 ? (
                        <p className="jf-field__hint">{t("menus.noPublished")}</p>
                      ) : (
                        (contentByType[addTab] ?? []).map((p) => (
                          <label key={p.id} className="jf-checkrow">
                            <input
                              type="checkbox"
                              checked={selectedContentIds.has(p.id)}
                              onChange={() => toggleContentSelection(p.id)}
                            />
                            <span className="jf-truncate">{p.title}</span>
                            <span className="jf-checkrow__meta">/{p.slug}</span>
                          </label>
                        ))
                      )}
                    </div>
                    <button
                      className="jf-btn jf-btn--primary jf-btn--block"
                      onClick={() => addSelectedContent(addTab)}
                      disabled={!(contentByType[addTab] ?? []).some((p) => selectedContentIds.has(p.id))}
                    >
                      {t("menus.addToMenu")}
                    </button>
                  </>
                )}

                {addTab === "custom" && (
                  <>
                    <input
                      className="jf-input"
                      placeholder={t("menus.customLabel")}
                      value={customLabel}
                      onChange={(e) => setCustomLabel(e.target.value)}
                    />
                    <input
                      className="jf-input"
                      placeholder={t("menus.customUrl")}
                      value={customUrl}
                      onChange={(e) => setCustomUrl(e.target.value)}
                    />
                    <label className="jf-checkrow">
                      <input
                        type="checkbox"
                        checked={customTarget}
                        onChange={(e) => setCustomTarget(e.target.checked)}
                      />
                      <span>{t("menus.openInNewTab")}</span>
                    </label>
                    <button
                      className="jf-btn jf-btn--primary jf-btn--block"
                      onClick={addCustomLink}
                      disabled={!customLabel.trim() || !customUrl.trim()}
                    >
                      {t("menus.addToMenu")}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {canManage && <MenuDesignPanel design={design} presets={designPresets} onChange={(d) => commit(items, d)} />}
        </div>

        <div className="jf-stack jf-stack--lg">
          <div className="jf-card">
            <div className="jf-card__head">
              <div className="jf-field" style={{ flex: 1, minWidth: 200 }}>
                <label className="jf-field__label" htmlFor="jf-menu-name">{t("menus.menuName")}</label>
                <input
                  id="jf-menu-name"
                  className="jf-input"
                  value={menuName}
                  onChange={(e) => {
                    setMenuName(e.target.value);
                    setSaved(false);
                  }}
                />
              </div>
              <div className="jf-row" style={{ gap: "0.35rem" }}>
                {canManage && (
                  <>
                    <button className="jf-iconbtn" title={t("common.undo")} aria-label={t("common.undo")} disabled={!history.canUndo} onClick={history.undo}>↺</button>
                    <button className="jf-iconbtn" title={t("common.redo")} aria-label={t("common.redo")} disabled={!history.canRedo} onClick={history.redo}>↻</button>
                  </>
                )}
                <span className="jf-meta">{t("menus.itemCount", { count: items.length })}</span>
              </div>
            </div>

            <div className="jf-card__body">
              <MenuTreeView
                items={items}
                maxDepth={design.maxDepth}
                selectedId={selectedItemId}
                canManage={canManage}
                typeLabel={typeLabel}
                contentSlugFor={contentSlugFor}
                onSelectItem={setSelectedItemId}
                onChange={(next) => commit(next, design)}
              />
            </div>
          </div>

          {selectedItem && canManage && (
            <MenuItemDrawer
              item={selectedItem}
              items={items}
              isMegaLayout={design.layout === "mega"}
              isTopLevel={selectedIsTopLevel}
              activeLocales={activeLocales}
              onChange={(next) => commit(next, design)}
              onClose={() => setSelectedItemId(null)}
            />
          )}

          <MenuPreviewPane ref={previewRef} />
        </div>
      </div>
    </>
  );
}
