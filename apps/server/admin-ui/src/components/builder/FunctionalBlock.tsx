// SPDX-License-Identifier: MIT
import { useT } from "../../i18n/I18nProvider";
import type { ReactNode } from "react";
import { coreBlocks } from "@justflows/blocks";

const definitions = new Map(coreBlocks.map(block => [block.type, block]));
/**
 * The functional block family: drawn here on the canvas, given the generic
 * inspector, and rendered by `render-blocks`. On the canvas most of them are
 * drawn by the public renderer (justflows-ce#311, see ServerBlock); only the
 * labelled stand-ins below are drawn here.
 */
export const FUNCTIONAL_TYPES = new Set(["core.list", "core.list-item", "core.table", "core.details", "core.accordion", "core.cover", "core.media-text", "core.buttons", "core.card", "core.icon", "core.callout", "core.tabs", "core.tab", "core.social-links", "core.table-of-contents", "core.site-logo", "core.site-title", "core.site-tagline", "core.navigation", "core.breadcrumbs", "core.content-query"]);
export default function FunctionalBlock({ type, props, children }: { type: string; props: Record<string, unknown>; children?: ReactNode }) {
  const { t } = useT();
  const def = definitions.get(type); if (!def) return null;
  const p = def.validateProps(props);
  switch (type) {
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
