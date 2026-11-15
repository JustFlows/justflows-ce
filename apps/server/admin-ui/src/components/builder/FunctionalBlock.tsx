// SPDX-License-Identifier: MIT
import { useT } from "../../i18n/I18nProvider";
import type { CSSProperties, ReactNode } from "react";
import { coreBlocks } from "@justflows/blocks";

const definitions = new Map(coreBlocks.map(block => [block.type, block]));
/**
 * The functional block family: drawn here on the canvas, given the generic
 * inspector, and rendered by `render-blocks`. Callout, Details, Cover and
 * Media & Text stay in the family but are drawn by the public renderer on the
 * canvas (justflows-ce#311, see ServerBlock).
 */
export const FUNCTIONAL_TYPES = new Set(["core.list", "core.list-item", "core.table", "core.details", "core.accordion", "core.cover", "core.media-text", "core.buttons", "core.card", "core.icon", "core.callout", "core.tabs", "core.tab", "core.social-links", "core.table-of-contents", "core.site-logo", "core.site-title", "core.site-tagline", "core.navigation", "core.breadcrumbs", "core.content-query"]);
export default function FunctionalBlock({ type, props, children }: { type: string; props: Record<string, unknown>; children?: ReactNode }) {
  const { t } = useT();
  const def = definitions.get(type); if (!def) return null;
  const p = def.validateProps(props);
  switch (type) {
    case "core.list": return p.listStyle === "numbered" ? <ol className="jf-list" start={Number(p.start)} reversed={p.reversed === true} style={{ listStyleType: ["disc", "circle", "square"].includes(String(p.marker)) ? "decimal" : String(p.marker), "--jf-list-gap": `${p.gap}px` } as CSSProperties}>{children}</ol> : <ul className={`jf-list${p.listStyle === "checklist" ? " jf-list--checklist" : ""}`} style={{ listStyleType: String(p.marker), "--jf-list-gap": `${p.gap}px` } as CSSProperties}>{children}</ul>;
    case "core.list-item": return <li className="jf-list-item"><label className="jf-list-check"><input type="checkbox" checked={p.checked === true} readOnly aria-label={t("builder.functional.checklistItem")} /></label><div className="jf-list-item-content"><div dangerouslySetInnerHTML={{ __html: String(p.text) }} />{children}</div></li>;
    case "core.accordion": return <div className="jf-accordion" style={{ gap: Number(p.gap) }}>{children}</div>;
    case "core.buttons": return <div className="jf-buttons" style={{ display: "flex", flexDirection: p.direction as CSSProperties["flexDirection"], flexWrap: p.wrap ? "wrap" : "nowrap", gap: Number(p.gap), justifyContent: p.align === "between" ? "space-between" : p.align === "left" ? "flex-start" : p.align === "right" ? "flex-end" : "center" }}>{children}</div>;
    case "core.card": return <div className={`jf-card jf-card--shadow-${p.shadow}`} style={{ padding: Number(p.padding), gap: Number(p.gap), border: p.border ? "1px solid var(--color-border,#ddd)" : "0", borderRadius: Number(p.radius), textAlign: p.align as CSSProperties["textAlign"] }}>{children}</div>;
    case "core.tabs": return <div className="jf-tabs">{children}</div>;
    case "core.tab": return <section className="jf-tab"><h3 className="jf-tab-heading">{String(p.title)}</h3>{children}</section>;
    case "core.site-logo":
    case "core.site-title":
    case "core.site-tagline":
    case "core.navigation":
    case "core.breadcrumbs":
    case "core.content-query": return <div className="jf-site-block-preview"><strong>{def.title}</strong><p>{t("builder.functional.dynamicPreview")}</p></div>;
    case "core.table-of-contents": return <nav className="jf-toc" aria-label={String(p.title)}><strong>{String(p.title)}</strong><p>{t("builder.functional.tocPreview")}</p></nav>;
    default: return <div dangerouslySetInnerHTML={{ __html: def.render(p) }} />;
  }
}
