import type { CSSProperties } from "react";
import type { PageHeaderConfig } from "../../lib/page-header";
import type { BlockCatalogEntry, BlockNode } from "./types";
import { HEADER_SELECTED_ID } from "../../lib/page-header";
import { HEADER_SLOT_PARENT_TYPE } from "./dnd";
import { PageCanvas } from "./BlockCanvas";

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

export function HeaderInspector({
  header,
  menus,
  siteDefaultSlug,
  onChange,
  libraryMode = false,
}: {
  header: PageHeaderConfig;
  menus: HeaderMenu[];
  siteDefaultSlug: string;
  onChange: (header: PageHeaderConfig) => void;
  /** Editing a library header in the theme customizer — there is no "this page". */
  libraryMode?: boolean;
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
      {!libraryMode && (
        <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={header.visible}
            onChange={(e) => set({ visible: e.target.checked })}
          />
          Show header on this page
        </label>
      )}
      {(libraryMode || header.visible) && (
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
          {header.showLanguageSwitcher && (
            <label style={{ ...fieldLabel, paddingLeft: "1.5rem" }}>
              Language selector style
              <select
                style={fieldInput}
                value={header.languageSwitcherStyle}
                onChange={(e) => set({ languageSwitcherStyle: e.target.value as PageHeaderConfig["languageSwitcherStyle"] })}
              >
                <option value="locale-full">Locale (nl-NL)</option>
                <option value="locale-short">Short locale (nl)</option>
                <option value="flags">Flags</option>
                <option value="flag-locale">Flag and locale</option>
                <option value="flag-country">Flag and country name</option>
              </select>
            </label>
          )}
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
        {header.showLanguageSwitcher ? (
          <span className="jf-header-chrome__widget">
            {header.languageSwitcherStyle === "locale-full" ? "en-US"
              : header.languageSwitcherStyle === "flags" ? "🇺🇸"
                : header.languageSwitcherStyle === "flag-locale" ? "🇺🇸 en"
                  : header.languageSwitcherStyle === "flag-country" ? "🇺🇸 United States"
                    : "en"} ⌄
          </span>
        ) : null}
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
