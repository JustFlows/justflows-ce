import { useEffect, useState } from "react";
import { Link } from "../../admin-router";
import { useT } from "../../i18n/I18nProvider";
import { useSessionRole } from "@components/SessionProvider";
import MenuEditor, {
  type ContentOption,
  type ContentTypeOption,
  type EditableMenu,
} from "../../components/menu-designer/MenuEditor";
import type { MenuDesignPreset } from "../../components/menu-designer/MenuDesignPanel";

const FALLBACK_CONTENT_TYPES: ContentTypeOption[] = [
  { slug: "page", label: "Page" },
  { slug: "post", label: "Post" },
];

function sortContentTypes(types: ContentTypeOption[]): ContentTypeOption[] {
  const rank = (slug: string) => (slug === "page" ? 0 : slug === "post" ? 1 : 2);
  return [...types].sort((a, b) => {
    const delta = rank(a.slug) - rank(b.slug);
    if (delta !== 0) return delta;
    return a.label.localeCompare(b.label);
  });
}

function normalizeContentTypes(types: ContentTypeOption[] | undefined): ContentTypeOption[] {
  const cleaned = sortContentTypes(
    (types ?? []).filter((type) => type.slug && type.label && type.slug !== "custom"),
  );
  return cleaned.length > 0 ? cleaned : FALLBACK_CONTENT_TYPES;
}

export default function MenusPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useT();
  // Saving a menu (and creating one) is administrator/editor-only on the
  // server; an author or contributor (who can also reach this page) can
  // still look at a menu's structure, just not persist changes to it.
  const role = useSessionRole();
  const canManage = role === "administrator" || role === "editor";
  const [menus, setMenus] = useState<EditableMenu[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("primary");
  const [designPresets, setDesignPresets] = useState<MenuDesignPreset[]>([]);
  const [activeLocales, setActiveLocales] = useState<string[]>([]);
  const [contentTypes, setContentTypes] = useState<ContentTypeOption[]>(FALLBACK_CONTENT_TYPES);
  const [contentByType, setContentByType] = useState<Record<string, ContentOption[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newMenuName, setNewMenuName] = useState("");
  const [newMenuSlug, setNewMenuSlug] = useState("");

  async function loadMenus(): Promise<EditableMenu[]> {
    const res = await fetch("/api/menus");
    const data = await res.json();
    const list: EditableMenu[] = data.menus ?? [];
    setMenus(list);
    return list;
  }

  async function loadSelectedMenu(slug: string): Promise<EditableMenu | null> {
    const res = await fetch(`/api/menus/${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.menu as EditableMenu;
  }

  async function loadDesignPresets() {
    try {
      const res = await fetch("/api/menus/design-presets");
      const data = await res.json();
      setDesignPresets(data.presets ?? []);
    } catch {
      setDesignPresets([]);
    }
  }

  async function loadContentOptions() {
    const langRes = await fetch("/api/languages");
    const langData = await langRes.json();
    const languages: Array<{ code: string; isDefault?: boolean; isActive?: boolean }> = langData.languages ?? [];
    const defaultLocale = languages.find((lang) => lang.isDefault)?.code ?? languages[0]?.code;
    setActiveLocales(languages.filter((l) => l.isActive !== false).map((l) => l.code));
    const localeQuery = defaultLocale ? `&locale=${encodeURIComponent(defaultLocale)}` : "";
    const typesRes = await fetch("/api/content-types");
    const typesData = await typesRes.json();
    const fetched = normalizeContentTypes(typesData.types as ContentTypeOption[] | undefined);
    const entries = await Promise.all(
      fetched.map(async (type) => {
        const res = await fetch(
          `/api/content?type=${encodeURIComponent(type.slug)}&status=published&limit=100${localeQuery}`,
        );
        const data = await res.json();
        return [type.slug, (data.items ?? []) as ContentOption[]] as const;
      }),
    );
    setContentTypes(fetched);
    setContentByType(Object.fromEntries(entries));
  }

  const [selectedMenu, setSelectedMenu] = useState<EditableMenu | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await loadMenus();
        await Promise.all([loadContentOptions(), loadDesignPresets()]);
        const slug = list.find((m) => m.slug === "primary")?.slug ?? list[0]?.slug ?? "primary";
        const menu = await loadSelectedMenu(slug);
        if (!cancelled) {
          setSelectedSlug(slug);
          setSelectedMenu(menu);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSelectMenu(slug: string) {
    setError(null);
    setSelectedSlug(slug);
    const menu = await loadSelectedMenu(slug);
    setSelectedMenu(menu);
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

  function handlePublished(menu: EditableMenu) {
    setMenus((prev) => prev.map((m) => (m.slug === menu.slug ? { ...m, name: menu.name } : m)));
  }

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
      {error && <div className="jf-alert jf-alert--error" role="alert">{error}</div>}

      <div className="jf-card">
        <div className="jf-card__head">
          <h2 className="jf-card__title">{t("menus.selectMenu")}</h2>
          {!embedded && (
            <Link to="/admin/themes" className="jf-btn jf-btn--ghost">{t("menus.backToThemes")}</Link>
          )}
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
          {currentMenu?.slug === "primary" && <p className="jf-field__hint">{t("menus.primaryHint")}</p>}
          {canManage && (
            <details>
              <summary>{t("menus.createMenu")}</summary>
              <div className="jf-stack jf-stack--sm" style={{ marginTop: "0.5rem" }}>
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
            </details>
          )}
        </div>
      </div>

      {selectedMenu && (
        <MenuEditor
          key={selectedSlug}
          menu={selectedMenu}
          canManage={canManage}
          contentTypes={contentTypes}
          contentByType={contentByType}
          activeLocales={activeLocales}
          designPresets={designPresets}
          onPublished={handlePublished}
        />
      )}
    </div>
  );
}
