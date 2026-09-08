/**
 * A mega-menu region is stored as a `BlockNode[]` (so it renders through the
 * same safe block pipeline as everything else), but almost every real region
 * is one of two shapes: a column of links, or a highlighted promo panel with
 * a heading/body/button. This module reads and writes those two shapes as
 * plain data — label/url pairs, plain text fields — so the drawer can offer a
 * form instead of a block editor for the common case. `detectRegionMode`
 * falls back to "custom" (the full embedded page builder) for anything that
 * does not match, so nothing already built with the block editor is lost.
 */
import { uid } from "../../lib/uid";
import type { BlockNode } from "../builder/types";
import type { MegaMenuRegion } from "./menu-tree";

export type MegaRegionMode = "links" | "promo" | "custom";

export interface LinkListEntry {
  label: string;
  url: string;
}

export const PROMO_BACKGROUNDS = ["default", "muted", "primary", "dark", "gradient"] as const;
export type PromoBackground = (typeof PROMO_BACKGROUNDS)[number];

export interface PromoContent {
  background: PromoBackground;
  heading: string;
  body: string;
  buttonLabel: string;
  buttonUrl: string;
}

function soleBlock(region: MegaMenuRegion): BlockNode | undefined {
  return region.blocks.length === 1 ? region.blocks[0] : undefined;
}

export function detectRegionMode(region: MegaMenuRegion): MegaRegionMode {
  if (region.blocks.length === 0) return "links"; // a freshly added region starts as the common case
  const block = soleBlock(region);
  if (block?.type === "core.link-list") return "links";
  if (block?.type === "core.section") return "promo";
  return "custom";
}

export function linkListItems(region: MegaMenuRegion): LinkListEntry[] {
  const block = soleBlock(region);
  if (block?.type !== "core.link-list") return [];
  const items = block.props.items;
  return Array.isArray(items)
    ? items.map((i) => ({
        label: String((i as { label?: unknown })?.label ?? ""),
        url: String((i as { url?: unknown })?.url ?? ""),
      }))
    : [];
}

export function withLinkListItems(region: MegaMenuRegion, items: LinkListEntry[]): MegaMenuRegion {
  const existing = soleBlock(region);
  const block: BlockNode =
    existing?.type === "core.link-list"
      ? { ...existing, props: { ...existing.props, items } }
      : { id: uid(), type: "core.link-list", version: 1, props: { heading: "", items } };
  return { ...region, blocks: [block] };
}

export function emptyLinksRegion(): MegaMenuRegion {
  return withLinkListItems({ id: uid(), blocks: [] }, [{ label: "", url: "" }]);
}

const DEFAULT_PROMO: PromoContent = {
  background: "dark",
  heading: "",
  body: "",
  buttonLabel: "",
  buttonUrl: "",
};

export function promoContent(region: MegaMenuRegion): PromoContent {
  const section = soleBlock(region);
  if (section?.type !== "core.section") return { ...DEFAULT_PROMO };
  const children = section.children ?? [];
  const heading = children.find((c) => c.type === "core.heading");
  const paragraph = children.find((c) => c.type === "core.paragraph");
  const button = children.find((c) => c.type === "core.button");
  const background = section.props.background;
  return {
    background: (PROMO_BACKGROUNDS as readonly string[]).includes(background as string)
      ? (background as PromoBackground)
      : DEFAULT_PROMO.background,
    heading: String(heading?.props.text ?? ""),
    body: String(paragraph?.props.text ?? ""),
    buttonLabel: String(button?.props.label ?? ""),
    buttonUrl: String(button?.props.url ?? ""),
  };
}

export function withPromoContent(region: MegaMenuRegion, content: PromoContent): MegaMenuRegion {
  const existing = soleBlock(region);
  const section = existing?.type === "core.section" ? existing : undefined;
  const findOrCreate = (type: string, props: Record<string, unknown>): BlockNode => {
    const found = section?.children?.find((c) => c.type === type);
    return found ? { ...found, props: { ...found.props, ...props } } : { id: uid(), type, version: 1, props };
  };
  const block: BlockNode = {
    id: section?.id ?? uid(),
    type: "core.section",
    version: 1,
    props: { background: content.background, padding: "lg", align: "left" },
    children: [
      findOrCreate("core.heading", { text: content.heading, level: 3 }),
      findOrCreate("core.paragraph", { text: content.body }),
      findOrCreate("core.button", { label: content.buttonLabel, url: content.buttonUrl, variant: "outline" }),
    ],
  };
  return { ...region, blocks: [block] };
}

export function emptyPromoRegion(): MegaMenuRegion {
  return withPromoContent({ id: uid(), blocks: [] }, { ...DEFAULT_PROMO });
}

export function emptyCustomRegion(): MegaMenuRegion {
  return { id: uid(), blocks: [] };
}
