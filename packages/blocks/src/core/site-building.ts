// SPDX-License-Identifier: MIT
import { withCoreInspectorConditions } from "./inspector-fields.js";
import type { BlockDefinition, BlockSchema } from "../registry/block-registry.js";
import { esc, sanitizeHref } from "../safe-url.js";
const str = (value: unknown, fallback = "") => typeof value === "string" ? value.slice(0, 500) : fallback;
const bool = (value: unknown, fallback = false) => typeof value === "boolean" ? value : fallback;
const num = (value: unknown, fallback: number, min: number, max: number) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Math.round(Number(value)))) : fallback;
const select = (options: string[], value: string): BlockSchema[string] => ({ type: "select", options, default: value });
const choice = (value: unknown, options: string[], fallback: string) => options.includes(str(value)) ? str(value) : fallback;
const txt = (value = ""): BlockSchema[string] => ({ type: "text", default: value });
const b = (value = false): BlockSchema[string] => ({ type: "boolean", default: value });
const n = (value: number): BlockSchema[string] => ({ type: "number", default: value });
function define(type: string, title: string, schema: BlockSchema, validate: (r: Record<string, unknown>) => Record<string, unknown>, render?: BlockDefinition["render"]): BlockDefinition {
  return { type: `core.${type}`, title, category: ["social-links", "table-of-contents", "content-query"].includes(type) ? "content" : "site", icon: "◈", version: 1, schema: withCoreInspectorConditions(type, schema),
    validateProps: raw => validate(raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}),
    render: render ?? (props => `<div class="jf-site-block jf-${type}"><!--jf-site:core.${type}:${encodeURIComponent(JSON.stringify(props))}--></div>`),
  };
}
export const siteBuildingBlocks: BlockDefinition[] = [
  define("site-logo", "Site Logo", { linkHome: b(true), width: n(160), alt: txt() }, r => ({ linkHome: bool(r["linkHome"], true), width: num(r["width"], 160, 16, 1000), alt: str(r["alt"]) })),
  define("site-title", "Site Title", { linkHome: b(true), level: n(2) }, r => ({ linkHome: bool(r["linkHome"], true), level: num(r["level"], 2, 1, 6) })),
  define("site-tagline", "Site Tagline", {}, () => ({})),
  define("navigation", "Navigation", { source: select(["primary", "footer"], "primary"), menuSlug: txt(), label: txt("Navigation"), showSubmenus: b(true), gap: n(16), mobileCollapse: b(true), menuLabel: txt("Menu"), menuLayout: select(["inherit", "horizontal", "vertical", "dropdown", "multi-level-dropdown", "mega", "footer", "drawer"], "inherit"), activation: select(["inherit", "hover", "click"], "inherit"), breakpoint: n(768), mobilePattern: select(["accordion", "dropdown", "drawer-left", "drawer-right", "fullscreen"], "accordion") },
    r => ({ source: choice(r["source"], ["primary", "footer"], "primary"), menuSlug: str(r["menuSlug"]).replace(/[^a-z0-9-]/g, "").slice(0, 80), label: str(r["label"], "Navigation"), direction: choice(r["direction"], ["row", "column"], "row"), showSubmenus: bool(r["showSubmenus"], true), gap: num(r["gap"], 16, 0, 100), mobileCollapse: bool(r["mobileCollapse"], true), menuLabel: str(r["menuLabel"], "Menu"), menuLayout: choice(r["menuLayout"], ["inherit", "horizontal", "vertical", "dropdown", "multi-level-dropdown", "mega", "footer", "drawer"], "inherit"), activation: choice(r["activation"], ["inherit", "hover", "click"], "inherit"), breakpoint: num(r["breakpoint"], 768, 320, 1400), mobilePattern: choice(r["mobilePattern"], ["accordion", "dropdown", "drawer-left", "drawer-right", "fullscreen"], "accordion") })),
  define("breadcrumbs", "Breadcrumbs", { homeLabel: txt("Home"), separator: txt("/"), showCurrent: b(true), label: txt("Breadcrumbs") },
    r => ({ homeLabel: str(r["homeLabel"], "Home"), separator: str(r["separator"], "/"), showCurrent: bool(r["showCurrent"], true), label: str(r["label"], "Breadcrumbs") })),
  define("social-links", "Social Links", { links: { type: "textarea", default: [] }, showLabels: b(true), newTab: b(true), direction: select(["row", "column"], "row"), gap: n(12), label: txt("Social profiles") },
    r => ({ links: (Array.isArray(r["links"]) ? r["links"] : []).slice(0, 30).map(raw => {
      const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      return { label: str(row["label"]), url: sanitizeHref(str(row["url"])), icon: choice(row["icon"], ["link", "facebook", "instagram", "linkedin", "youtube", "tiktok", "x", "github", "mastodon"], "link") };
    }), showLabels: bool(r["showLabels"], true), newTab: bool(r["newTab"], true), direction: choice(r["direction"], ["row", "column"], "row"), gap: num(r["gap"], 12, 0, 100), label: str(r["label"], "Social profiles") }),
    p => { const icons: Record<string, string> = { link: "↗", facebook: "f", instagram: "◎", linkedin: "in", youtube: "▶", tiktok: "♪", x: "𝕏", github: "GH", mastodon: "m" };
      return `<nav class="jf-social-links" aria-label="${esc(String(p["label"]))}" style="display:flex;flex-wrap:wrap;flex-direction:${p["direction"]};gap:${p["gap"]}px">${(p["links"] as Array<{ label: string; url: string; icon: string }>).filter(link => link.url !== "#").map(link => `<a href="${esc(link.url)}" aria-label="${esc(link.label || link.icon)}"${p["newTab"] ? ' target="_blank" rel="noopener noreferrer"' : ''}><span aria-hidden="true">${icons[link.icon]}</span>${p["showLabels"] ? ` ${esc(link.label || link.icon)}` : ''}</a>`).join('')}</nav>`; }),
  define("table-of-contents", "Table of Contents", { title: txt("On this page"), minLevel: n(2), maxLevel: n(3), numbered: b(true), hideIfEmpty: b(true) },
    r => { const minLevel = num(r["minLevel"], 2, 1, 6); return { title: str(r["title"], "On this page"), minLevel, maxLevel: num(r["maxLevel"], 3, minLevel, 6), numbered: bool(r["numbered"], true), hideIfEmpty: bool(r["hideIfEmpty"], true) }; },
    p => `<nav class="jf-toc" aria-label="${esc(String(p["title"]))}" data-jf-min="${p["minLevel"]}" data-jf-max="${p["maxLevel"]}" data-jf-numbered="${p["numbered"]}" data-jf-hide-empty="${p["hideIfEmpty"]}"><strong>${esc(String(p["title"]))}</strong><div data-jf-toc-items></div></nav>`),
  define("content-query", "Content Query", { contentType: txt("post"), taxonomy: txt(), term: txt(), orderBy: select(["published", "title", "updated"], "published"), order: select(["desc", "asc"], "desc"), limit: n(6), offset: n(0), pagination: b(true), pageKey: txt("content-page"), layout: select(["grid", "list"], "grid"), columns: n(3), showImage: b(true), showExcerpt: b(true), showDate: b(true), titleLevel: n(3), emptyLabel: txt("No content found."), previousLabel: txt("Previous"), nextLabel: txt("Next") },
    r => ({ contentType: str(r["contentType"], "post").replace(/[^a-z0-9-]/g, '').slice(0, 60), taxonomy: str(r["taxonomy"]).replace(/[^a-z0-9-]/g, '').slice(0, 60), term: str(r["term"]).slice(0, 200), orderBy: choice(r["orderBy"], ["published", "title", "updated"], "published"), order: choice(r["order"], ["desc", "asc"], "desc"), limit: num(r["limit"], 6, 1, 100), offset: num(r["offset"], 0, 0, 10000), pagination: bool(r["pagination"], true), pageKey: /^[a-z][a-z0-9-]{0,30}-page$/.test(str(r["pageKey"])) ? str(r["pageKey"]) : "content-page", layout: choice(r["layout"], ["grid", "list"], "grid"), columns: num(r["columns"], 3, 1, 6), showImage: bool(r["showImage"], true), showExcerpt: bool(r["showExcerpt"], true), showDate: bool(r["showDate"], true), titleLevel: num(r["titleLevel"], 3, 1, 6), emptyLabel: str(r["emptyLabel"], "No content found."), previousLabel: str(r["previousLabel"], "Previous"), nextLabel: str(r["nextLabel"], "Next") })),
];
