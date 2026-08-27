import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "../../i18n/I18nProvider";
import { useSessionRole } from "@components/SessionProvider";

type MenuItemType = "custom" | "page" | "post";

interface MenuItem {
  id: string;
  label: string;
  type: MenuItemType;
  url?: string;
  contentId?: string;
  target?: "_blank";
  children?: MenuItem[];
}

interface Menu {
  id: string;
  slug: string;
  name: string;
  items: MenuItem[];
}

interface ContentOption {
  id: string;
  title: string;
  slug: string;
  type: string;
  locale: string;
}

type AddTab = "pages" | "posts" | "custom";

function newItemId(): string {
  return crypto.randomUUID();
}

function cloneItems(items: MenuItem[]): MenuItem[] {
  return items.map((item) => ({
    ...item,
    children: item.children ? cloneItems(item.children) : undefined,
  }));
}

function updateItemTree(
  items: MenuItem[],
  id: string,
  updater: (item: MenuItem) => MenuItem,
): MenuItem[] {
  return items.map((item) => {
    if (item.id === id) return updater(item);
    if (item.children?.length) {
      return { ...item, children: updateItemTree(item.children, id, updater) };
    }
    return item;
  });
}

function removeItemTree(items: MenuItem[], id: string): MenuItem[] {
  return items
    .filter((item) => item.id !== id)
    .map((item) =>
      item.children?.length
        ? { ...item, children: removeItemTree(item.children, id) }
        : item,
    );
}

function addChildItem(items: MenuItem[], parentId: string, child: MenuItem): MenuItem[] {
  return items.map((item) => {
    if (item.id === parentId) {
      return { ...item, children: [...(item.children ?? []), child] };
    }
    if (item.children?.length) {
      return { ...item, children: addChildItem(item.children, parentId, child) };
    }
    return item;
  });
}

function moveItem(items: MenuItem[], id: string, direction: -1 | 1): MenuItem[] {
  const idx = items.findIndex((item) => item.id === id);
  if (idx >= 0) {
    const next = idx + direction;
    if (next < 0 || next >= items.length) return items;
    const copy = [...items];
    const [removed] = copy.splice(idx, 1);
    copy.splice(next, 0, removed!);
    return copy;
  }

  return items.map((item) =>
    item.children?.length
      ? { ...item, children: moveItem(item.children, id, direction) }
      : item,
  );
}

function flattenItems(items: MenuItem[], depth = 0): Array<{ item: MenuItem; depth: number }> {
  const out: Array<{ item: MenuItem; depth: number }> = [];
  for (const item of items) {
    out.push({ item, depth });
    if (item.children?.length) {
      out.push(...flattenItems(item.children, depth + 1));
    }
  }
  return out;
}

export default function MenusPage() {
  const { t } = useT();
  // Saving a menu (and creating one) is administrator/editor-only on the
  // server; an author or contributor (who can also reach this page) can
  // still look at a menu's structure, just not persist changes to it.
  const role = useSessionRole();
  const canManage = role === "administrator" || role === "editor";
  const [menus, setMenus] = useState<Menu[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("primary");
  const [items, setItems] = useState<MenuItem[]>([]);
  const [menuName, setMenuName] = useState("");
  const [pages, setPages] = useState<ContentOption[]>([]);
  const [posts, setPosts] = useState<ContentOption[]>([]);
  const [addTab, setAddTab] = useState<AddTab>("pages");
  const [selectedContentIds, setSelectedContentIds] = useState<Set<string>>(new Set());
  const [customLabel, setCustomLabel] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [customTarget, setCustomTarget] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newMenuName, setNewMenuName] = useState("");
  const [newMenuSlug, setNewMenuSlug] = useState("");

  async function loadMenus() {
    const res = await fetch("/api/menus");
    const data = await res.json();
    const list: Menu[] = data.menus ?? [];
    setMenus(list);
    return list;
  }

  async function loadContentOptions() {
    const [pagesRes, postsRes] = await Promise.all([
      fetch("/api/content?type=page&status=published&limit=100"),
      fetch("/api/content?type=post&status=published&limit=100"),
    ]);
    const pagesData = await pagesRes.json();
    const postsData = await postsRes.json();
    setPages(pagesData.items ?? []);
    setPosts(postsData.items ?? []);
  }

  async function loadMenu(slug: string) {
    const res = await fetch(`/api/menus/${encodeURIComponent(slug)}`);
    if (!res.ok) return;
    const data = await res.json();
    const menu: Menu = data.menu;
    setItems(cloneItems(menu.items ?? []));
    setMenuName(menu.name);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await loadMenus();
        await loadContentOptions();
        const slug = list.find((m) => m.slug === "primary")?.slug ?? list[0]?.slug ?? "primary";
        if (!cancelled) {
          setSelectedSlug(slug);
          await loadMenu(slug);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSelectMenu(slug: string) {
    setSelectedSlug(slug);
    setSaved(false);
    setError(null);
    await loadMenu(slug);
  }

  async function saveMenu() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`/api/menus/${encodeURIComponent(selectedSlug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: menuName, items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setItems(cloneItems(data.menu.items ?? []));
      setMenuName(data.menu.name);
      setSaved(true);
      await loadMenus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function createMenu() {
    if (!newMenuName.trim() || !newMenuSlug.trim()) return;
    setError(null);
    const res = await fetch("/api/menus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newMenuName.trim(),
        slug: newMenuSlug.trim().toLowerCase().replace(/\s+/g, "-"),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to create menu");
      return;
    }
    setNewMenuName("");
    setNewMenuSlug("");
    const list = await loadMenus();
    const slug = data.menu?.slug ?? list[list.length - 1]?.slug;
    if (slug) await handleSelectMenu(slug);
  }

  function toggleContentSelection(id: string) {
    setSelectedContentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addSelectedContent(type: "page" | "post") {
    const source = type === "page" ? pages : posts;
    const toAdd = source.filter((c) => selectedContentIds.has(c.id));
    if (!toAdd.length) return;

    const newItems: MenuItem[] = toAdd.map((c) => ({
      id: newItemId(),
      label: c.title,
      type,
      contentId: c.id,
      url: `/${c.slug}`,
    }));

    setItems((prev) => [...prev, ...newItems]);
    setSelectedContentIds(new Set());
    setSaved(false);
  }

  function addCustomLink() {
    if (!customLabel.trim() || !customUrl.trim()) return;
    const item: MenuItem = {
      id: newItemId(),
      label: customLabel.trim(),
      type: "custom",
      url: customUrl.trim(),
      ...(customTarget ? { target: "_blank" as const } : {}),
    };
    setItems((prev) => [...prev, item]);
    setCustomLabel("");
    setCustomUrl("");
    setCustomTarget(false);
    setSaved(false);
  }

  function addSubItem(parentId: string) {
    const child: MenuItem = {
      id: newItemId(),
      label: t("menus.newSubItem"),
      type: "custom",
      url: "#",
    };
    setItems((prev) => addChildItem(prev, parentId, child));
    setSaved(false);
  }

  const flatItems = flattenItems(items);

  if (loading) {
    return (
      <div className="jf-page" aria-busy="true" aria-label={t("common.loading")}>
        <div className="jf-skeleton" style={{ height: 44, maxWidth: 260 }} />
        <div className="jf-skeleton" style={{ height: 320 }} />
      </div>
    );
  }

  const currentMenu = menus.find((m) => m.slug === selectedSlug);

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>{t("menus.title")}</h1>
          <p>{t("menus.subtitle")}</p>
        </div>
        <div className="jf-pagehead__actions">
          <Link to="/admin/themes" className="jf-btn jf-btn--ghost">{t("menus.backToThemes")}</Link>
          {canManage && (
            <button className="jf-btn jf-btn--primary" onClick={saveMenu} disabled={saving}>
              {saving ? t("common.saving") : t("common.save")}
            </button>
          )}
        </div>
      </header>

      {error && <div className="jf-alert jf-alert--error" role="alert">{error}</div>}
      {saved && <div className="jf-alert jf-alert--success">{t("common.saved")}</div>}

      <div className="jf-split--wide">
        <div className="jf-stack jf-stack--lg">
          <div className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">{t("menus.selectMenu")}</h2>
            </div>
            <div className="jf-card__body jf-stack jf-stack--sm">
              <select
                className="jf-input"
                value={selectedSlug}
                onChange={(e) => handleSelectMenu(e.target.value)}
                aria-label={t("menus.selectMenu")}
              >
                {menus.map((menu) => (
                  <option key={menu.slug} value={menu.slug}>
                    {menu.name} ({menu.slug})
                  </option>
                ))}
              </select>
              {currentMenu?.slug === "primary" && (
                <p className="jf-field__hint">{t("menus.primaryHint")}</p>
              )}
            </div>
          </div>

          {canManage && (
          <div className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">{t("menus.addItems")}</h2>
            </div>
            <div className="jf-card__body jf-stack">
              <div className="jf-filterbar">
                {(["pages", "posts", "custom"] as AddTab[]).map((tab) => (
                  <button
                    key={tab}
                    className="jf-chip"
                    aria-pressed={addTab === tab}
                    onClick={() => setAddTab(tab)}
                  >
                    {t(`menus.tab.${tab}`)}
                  </button>
                ))}
              </div>

              {addTab === "pages" && (
                <>
                  <div className="jf-scrolllist">
                    {pages.length === 0 ? (
                      <p className="jf-field__hint">{t("menus.noPages")}</p>
                    ) : (
                      pages.map((p) => (
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
                    onClick={() => addSelectedContent("page")}
                    disabled={!pages.some((p) => selectedContentIds.has(p.id))}
                  >
                    {t("menus.addToMenu")}
                  </button>
                </>
              )}

              {addTab === "posts" && (
                <>
                  <div className="jf-scrolllist">
                    {posts.length === 0 ? (
                      <p className="jf-field__hint">{t("menus.noPosts")}</p>
                    ) : (
                      posts.map((p) => (
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
                    onClick={() => addSelectedContent("post")}
                    disabled={!posts.some((p) => selectedContentIds.has(p.id))}
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

          {canManage && (
          <div className="jf-card">
            <div className="jf-card__head">
              <h2 className="jf-card__title">{t("menus.createMenu")}</h2>
            </div>
            <div className="jf-card__body jf-stack jf-stack--sm">
              <input
                className="jf-input"
                placeholder={t("menus.menuName")}
                value={newMenuName}
                onChange={(e) => setNewMenuName(e.target.value)}
              />
              <input
                className="jf-input"
                placeholder={t("menus.menuSlug")}
                value={newMenuSlug}
                onChange={(e) => setNewMenuSlug(e.target.value)}
              />
              <button className="jf-btn jf-btn--ghost jf-btn--block" onClick={createMenu}>
                {t("menus.createMenuButton")}
              </button>
            </div>
          </div>
          )}
        </div>

        <div className="jf-card">
          <div className="jf-card__head">
            <div className="jf-field" style={{ flex: 1, minWidth: 200 }}>
              <label className="jf-field__label" htmlFor="jf-menu-name">{t("menus.menuName")}</label>
              <input
                id="jf-menu-name"
                className="jf-input"
                value={menuName}
                onChange={(e) => { setMenuName(e.target.value); setSaved(false); }}
              />
            </div>
            <span className="jf-meta">{t("menus.itemCount", { count: flatItems.length })}</span>
          </div>

          <div className="jf-card__body">
            {items.length === 0 ? (
              <div className="jf-empty">
                <span className="jf-empty__icon" aria-hidden="true">☰</span>
                <span className="jf-empty__title">{t("menus.empty")}</span>
                <p>{t("menus.emptyHint")}</p>
              </div>
            ) : (
              <div className="jf-stack jf-stack--sm">
                {flatItems.map(({ item, depth }) => (
                  <div key={item.id} className="jf-itemrow" data-depth={depth}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <input
                        className="jf-input"
                        value={item.label}
                        aria-label={t("menus.customLabel")}
                        onChange={(e) => {
                          setItems((prev) =>
                            updateItemTree(prev, item.id, (i) => ({ ...i, label: e.target.value })),
                          );
                          setSaved(false);
                        }}
                      />
                      <div className="jf-row" style={{ marginTop: "0.4rem" }}>
                        <span className="jf-badge jf-badge--info">{t(`menus.type.${item.type}`)}</span>
                        {item.type === "custom" && (
                          <input
                            className="jf-input"
                            style={{ flex: 1, minWidth: 120 }}
                            value={item.url ?? ""}
                            placeholder="URL"
                            aria-label={t("menus.customUrl")}
                            onChange={(e) => {
                              setItems((prev) =>
                                updateItemTree(prev, item.id, (i) => ({ ...i, url: e.target.value })),
                              );
                              setSaved(false);
                            }}
                          />
                        )}
                        {(item.type === "page" || item.type === "post") && item.contentId && (
                          <span className="jf-meta">
                            {pages.find((p) => p.id === item.contentId)?.slug
                              ?? posts.find((p) => p.id === item.contentId)?.slug
                              ?? item.contentId.slice(0, 8)}
                          </span>
                        )}
                        {item.type === "custom" && (
                          <label className="jf-checkrow" style={{ fontSize: "0.75rem" }}>
                            <input
                              type="checkbox"
                              checked={item.target === "_blank"}
                              onChange={(e) => {
                                setItems((prev) =>
                                  updateItemTree(prev, item.id, (i) => ({
                                    ...i,
                                    target: e.target.checked ? "_blank" : undefined,
                                  })),
                                );
                                setSaved(false);
                              }}
                            />
                            <span>{t("menus.newTab")}</span>
                          </label>
                        )}
                      </div>
                    </div>

                    <div className="jf-stack" style={{ gap: "0.25rem", flexShrink: 0 }}>
                      <button
                        className="jf-iconbtn"
                        title={t("menus.moveUp")}
                        aria-label={t("menus.moveUp")}
                        onClick={() => { setItems((prev) => moveItem(prev, item.id, -1)); setSaved(false); }}
                      >↑</button>
                      <button
                        className="jf-iconbtn"
                        title={t("menus.moveDown")}
                        aria-label={t("menus.moveDown")}
                        onClick={() => { setItems((prev) => moveItem(prev, item.id, 1)); setSaved(false); }}
                      >↓</button>
                      <button
                        className="jf-iconbtn"
                        title={t("menus.addSubItem")}
                        aria-label={t("menus.addSubItem")}
                        onClick={() => addSubItem(item.id)}
                      >+</button>
                      <button
                        className="jf-iconbtn jf-iconbtn--danger"
                        title={t("common.delete")}
                        aria-label={t("common.delete")}
                        onClick={() => { setItems((prev) => removeItemTree(prev, item.id)); setSaved(false); }}
                      >×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
