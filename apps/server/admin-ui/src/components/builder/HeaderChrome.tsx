import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useSessionRole } from "@components/SessionProvider";
import type { PageHeaderConfig } from "../../lib/page-header";
import type { BlockCatalogEntry, BlockNode } from "./types";
import { HEADER_SELECTED_ID } from "../../lib/page-header";
import { HEADER_SLOT_PARENT_TYPE } from "./dnd";
import { PageCanvas } from "./BlockCanvas";
import { cloneBlocks, reassignBlockIds } from "./block-tree";

export interface HeaderMenuItem {
  id: string;
  label: string;
  children?: HeaderMenuItem[];
}

export interface HeaderMenu {
  slug: string;
  name: string;
  items: HeaderMenuItem[];
}

export interface HeaderIdentity {
  siteTitle: string;
  logoUrl: string;
}

function labelsFromItems(items: HeaderMenuItem[], depth = 0): string[] {
  const labels: string[] = [];
  for (const item of items) {
    if (item.label?.trim()) labels.push(item.label.trim());
    if (depth < 1 && item.children?.length) {
      labels.push(...labelsFromItems(item.children, depth + 1));
    }
  }
  return labels;
}

export function previewNavLabels(
  header: PageHeaderConfig,
  menus: HeaderMenu[],
  siteDefaultSlug: string,
): string[] {
  if (!header.visible || header.menuMode === "none") return [];
  const slug = header.menuMode === "menu" ? header.menuSlug : siteDefaultSlug;
  const menu = menus.find((m) => m.slug === slug);
  return menu ? labelsFromItems(menu.items) : [];
}

export interface HeaderPresetItem {
  id: string;
  name: string;
  updatedAt: string;
  header: PageHeaderConfig;
}

/**
 * Pick a header already built elsewhere, or save this page's header so
 * another page can start from it. Applying copies the config — later edits
 * on either page stay independent, same as pasting a pattern.
 */
function HeaderPresetPanel({
  header,
  onChange,
}: {
  header: PageHeaderConfig;
  onChange: (header: PageHeaderConfig) => void;
}) {
  // Saving and deleting a saved header are administrator/editor-only on the
  // server; applying one to the current page is just a local copy, open to
  // any content-write role.
  const role = useSessionRole();
  const canManagePresets = role === "administrator" || role === "editor";
  const [items, setItems] = useState<HeaderPresetItem[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(() => {
    fetch("/api/header-presets")
      .then((r) => r.json())
      .then((body: { items?: HeaderPresetItem[] }) => setItems(body.items ?? []))
      .catch(() => setItems([]));
  }, []);

  useEffect(reload, [reload]);

  function apply() {
    const preset = items.find((item) => item.id === selected);
    if (!preset) return;
    onChange({
      ...preset.header,
      blocks: reassignBlockIds(cloneBlocks(preset.header.blocks)),
    });
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/header-presets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || undefined, header }),
      });
      const body = (await res.json()) as { error?: string; item?: HeaderPresetItem };
      if (!res.ok || !body.item) throw new Error(body.error ?? "Could not save");
      setName("");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this saved header? Pages already using it keep their own copy.")) return;
    await fetch(`/api/header-presets/${id}`, { method: "DELETE" });
    if (selected === id) setSelected("");
    reload();
  }

  const fieldInput: CSSProperties = {
    padding: "0.4rem 0.6rem",
    border: "1px solid var(--jf-border-strong)",
    borderRadius: 5,
    fontSize: "0.875rem",
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };
  const smallButton: CSSProperties = { padding: "0.4rem 0.7rem", fontSize: "0.8rem", whiteSpace: "nowrap" };

  return (
    <div
      style={{
        marginBottom: "0.9rem",
        padding: "0.75rem",
        border: "1px solid var(--jf-border)",
        borderRadius: 6,
        background: "var(--jf-surface-2)",
      }}
    >
      <p style={{ fontSize: "0.75rem", color: "var(--jf-text-3)", margin: "0 0 0.5rem", fontWeight: 700 }}>
        Saved headers
      </p>
      {items.length > 0 ? (
        <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.6rem" }}>
          <select style={{ ...fieldInput, flex: 1 }} value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Apply a saved header…</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button type="button" style={smallButton} disabled={!selected} onClick={apply}>
            Apply
          </button>
          {selected && canManagePresets && (
            <button type="button" style={smallButton} title="Delete saved header" onClick={() => void remove(selected)}>
              ×
            </button>
          )}
        </div>
      ) : (
        <p style={{ fontSize: "0.75rem", color: "var(--jf-text-3)", margin: "0 0 0.6rem" }}>
          No saved headers yet — build one below, then save it to reuse on other pages.
        </p>
      )}
      {canManagePresets && (
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <input
            style={{ ...fieldInput, flex: 1 }}
            type="text"
            placeholder="Name this header…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="button" style={smallButton} disabled={busy} onClick={() => void save()}>
            Save as new
          </button>
        </div>
      )}
      {error && <p style={{ fontSize: "0.75rem", color: "var(--jf-danger)", margin: "0.4rem 0 0" }}>{error}</p>}
      <p style={{ fontSize: "0.7rem", color: "var(--jf-text-3)", margin: "0.4rem 0 0" }}>
        Applying copies the layout, widgets, and blocks onto this page — later edits stay independent.
      </p>
    </div>
  );
}

export function HeaderInspector({
  header,
  menus,
  siteDefaultSlug,
  onChange,
}: {
  header: PageHeaderConfig;
  menus: HeaderMenu[];
  siteDefaultSlug: string;
  onChange: (header: PageHeaderConfig) => void;
}) {
  const set = (patch: Partial<PageHeaderConfig>) => onChange({ ...header, ...patch });
  const fieldLabel: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "var(--jf-text-2)",
    marginBottom: "0.75rem",
  };
  const fieldInput: CSSProperties = {
    padding: "0.4rem 0.6rem",
    border: "1px solid var(--jf-border-strong)",
    borderRadius: 5,
    fontSize: "0.875rem",
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div>
      <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem" }}>Header &amp; navigation</h3>
      <HeaderPresetPanel header={header} onChange={onChange} />
      <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
        <input
          type="checkbox"
          checked={header.visible}
          onChange={(e) => set({ visible: e.target.checked })}
        />
        Show header on this page
      </label>
      {header.visible && (
        <>
          <label style={fieldLabel}>
            Navigation menu
            <select
              style={fieldInput}
              value={header.menuMode}
              onChange={(e) => set({ menuMode: e.target.value as PageHeaderConfig["menuMode"] })}
            >
              <option value="inherit">Site default ({siteDefaultSlug || "primary"})</option>
              <option value="menu">A specific menu</option>
              <option value="none">No menu</option>
            </select>
          </label>
          {header.menuMode === "menu" && (
            <label style={fieldLabel}>
              Menu
              <select
                style={fieldInput}
                value={header.menuSlug}
                onChange={(e) => set({ menuSlug: e.target.value })}
              >
                <option value="">Select a menu…</option>
                {menus.map((menu) => (
                  <option key={menu.slug} value={menu.slug}>
                    {menu.name} ({menu.slug})
                  </option>
                ))}
              </select>
            </label>
          )}
          <p style={{ fontSize: "0.75rem", color: "var(--jf-text-3)", margin: "0 0 0.9rem" }}>
            Edit menu links in{" "}
            <a href="/admin/menus" target="_blank" rel="noopener noreferrer">Menus</a>.
          </p>
          <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={header.showLogo}
              onChange={(e) => set({ showLogo: e.target.checked })}
            />
            Show logo
          </label>
          <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={header.showTitle}
              onChange={(e) => set({ showTitle: e.target.checked })}
            />
            Show site title
          </label>
          <label style={fieldLabel}>
            Layout
            <select
              style={fieldInput}
              value={header.layout}
              onChange={(e) => set({ layout: e.target.value as PageHeaderConfig["layout"] })}
            >
              <option value="logo-left">Logo left, menu right</option>
              <option value="logo-center">Centered</option>
              <option value="split">Split</option>
            </select>
          </label>
          <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={header.sticky}
              onChange={(e) => set({ sticky: e.target.checked })}
            />
            Sticky header
          </label>
          <label style={fieldLabel}>
            Background
            <input
              style={fieldInput}
              type="text"
              placeholder="Theme default"
              value={header.background}
              onChange={(e) => set({ background: e.target.value })}
            />
          </label>
          <p style={{ fontSize: "0.75rem", color: "var(--jf-text-3)", margin: "0.25rem 0 0.6rem", fontWeight: 700 }}>
            Header widgets
          </p>
          <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={header.showLanguageSwitcher}
              onChange={(e) => set({ showLanguageSwitcher: e.target.checked })}
            />
            Language switcher
          </label>
          <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={header.showColorScheme}
              onChange={(e) => set({ showColorScheme: e.target.checked })}
            />
            Light / dark toggle
          </label>
          {header.showColorScheme && (
            <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: "0.5rem", paddingLeft: "1.5rem" }}>
              <input
                type="checkbox"
                checked={header.showColorSchemeSystem}
                onChange={(e) => set({ showColorSchemeSystem: e.target.checked })}
              />
              Add an “Auto” option
            </label>
          )}
          <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={header.showAuthLinks}
              onChange={(e) => set({ showAuthLinks: e.target.checked })}
            />
            Login / register
          </label>
          <p style={{ fontSize: "0.75rem", color: "var(--jf-text-3)", margin: "0 0 0.5rem" }}>
            Drag any block from the library into the header. Site blocks include light/dark, language, and login/register. Register only appears on the public site when Settings → Anyone can register is on.
          </p>
        </>
      )}
    </div>
  );
}

export default function HeaderChrome({
  header,
  identity,
  navLabels,
  selected,
  selectedId,
  catalog,
  compact,
  onSelect,
  onSelectBlock,
  onBlocksChange,
}: {
  header: PageHeaderConfig;
  identity: HeaderIdentity;
  navLabels: string[];
  selected: boolean;
  selectedId: string | null;
  catalog: Map<string, BlockCatalogEntry>;
  compact?: boolean;
  onSelect: () => void;
  onSelectBlock: (id: string | null) => void;
  onBlocksChange: (blocks: BlockNode[]) => void;
}) {
  if (!header.visible) {
    return (
      <button
        type="button"
        className={`jf-header-chrome jf-header-chrome--hidden${selected ? " is-selected" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        Header hidden on this page — click to restore
      </button>
    );
  }

  const layoutClass =
    header.layout === "logo-center"
      ? " jf-header-chrome--center"
      : header.layout === "split"
        ? " jf-header-chrome--split"
        : "";
  const headerBlocks = Array.isArray(header.blocks) ? (header.blocks as BlockNode[]) : [];

  return (
    <div
      className={`jf-header-chrome${layoutClass}${selected ? " is-selected" : ""}`}
      style={header.background ? { background: header.background } : undefined}
      role="group"
      aria-label="Edit header and navigation"
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <span className="jf-header-chrome__brand">
        {header.showLogo && identity.logoUrl ? (
          <img src={identity.logoUrl} alt="" className="jf-header-chrome__logo" />
        ) : null}
        {header.showTitle ? (
          <span className="jf-header-chrome__title">{identity.siteTitle || "Site title"}</span>
        ) : null}
      </span>
      <span className="jf-header-chrome__nav">
        {navLabels.length > 0 ? (
          navLabels.slice(0, compact ? 4 : 8).map((label) => (
            <span key={label} className="jf-header-chrome__link">{label}</span>
          ))
        ) : (
          <span className="jf-header-chrome__empty">No menu items — click to choose a menu</span>
        )}
        {header.showLanguageSwitcher ? <span className="jf-header-chrome__widget">EN</span> : null}
        {header.showColorScheme ? <span className="jf-header-chrome__widget">◐</span> : null}
        {header.showAuthLinks ? <span className="jf-header-chrome__widget">Log in</span> : null}
        <div
          className="jf-header-chrome__blocks"
          onClick={(e) => e.stopPropagation()}
        >
          <PageCanvas
            blocks={headerBlocks}
            catalog={catalog}
            selectedId={selectedId}
            onSelect={onSelectBlock}
            onChange={onBlocksChange}
            rootParentId={HEADER_SELECTED_ID}
            rootParentType={HEADER_SLOT_PARENT_TYPE}
            compact
            showEmptyState={false}
            showAddSlot
            addLabel="+ Add to header"
            emptyLabel="Drop blocks here"
          />
        </div>
      </span>
    </div>
  );
}
