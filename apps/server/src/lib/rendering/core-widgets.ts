// SPDX-License-Identifier: MIT

import { esc, sanitizeRichText, type BlockDefinition } from "@justflows/blocks";
import { getRuntimeBlockRegistry } from "./runtime-blocks.js";
import type { BlockNode } from "../runtime/types.js";

/**
 * Core widgets: blocks made for widget areas (category `widgets`). Their
 * `render()` is synchronous like every block, so the data a widget shows (menu
 * items, recent posts, the localized search URL) is attached to its props as
 * `__data` by {@link withCoreWidgetData} just before a widget area renders.
 * Outside a widget area a data widget renders its empty state.
 */

export const CONTENT_WIDGET = "core.widget-content";
export const MENU_WIDGET = "core.widget-menu";
export const RECENT_POSTS_WIDGET = "core.widget-recent-posts";
export const SEARCH_WIDGET = "core.widget-search";

export const CORE_WIDGET_TYPES = new Set([CONTENT_WIDGET, MENU_WIDGET, RECENT_POSTS_WIDGET, SEARCH_WIDGET]);

const DATA_KEY = "__data";
const MAX_POSTS = 20;
const MAX_MENU_DEPTH = 4;

export interface WidgetMenuItem {
  label: string;
  url: string;
  target?: string;
  children?: WidgetMenuItem[];
}

export interface WidgetPost {
  title: string;
  href: string;
  date: string;
}

/** What {@link withCoreWidgetData} needs to look things up for one request. */
export interface CoreWidgetDataSource {
  menu(slug: string): Promise<WidgetMenuItem[]>;
  recentPosts(limit: number): Promise<WidgetPost[]>;
  searchAction(): string;
}

function str(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

function count(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(MAX_POSTS, Math.max(1, Math.trunc(n))) : fallback;
}

function data<T>(props: Record<string, unknown>): T | undefined {
  return props[DATA_KEY] as T | undefined;
}

function title(text: string): string {
  return text ? `<h2 class="jf-widget__title">${esc(text)}</h2>` : "";
}

function safeHref(url: string): string {
  const trimmed = url.trim();
  return /^(?:https?:\/\/|\/(?!\/)|#|mailto:|tel:)/i.test(trimmed) ? trimmed : "#";
}

function menuList(items: WidgetMenuItem[], depth = 0): string {
  if (!items.length || depth >= MAX_MENU_DEPTH) return "";
  const rows = items
    .map((item) => {
      const target = item.target === "_blank" ? ' target="_blank" rel="noopener"' : "";
      return `<li><a href="${esc(safeHref(item.url))}"${target}>${esc(item.label)}</a>${menuList(item.children ?? [], depth + 1)}</li>`;
    })
    .join("");
  return `<ul class="jf-widget__list">${rows}</ul>`;
}

function keepData(raw: unknown, props: Record<string, unknown>): Record<string, unknown> {
  const source = (raw ?? {}) as Record<string, unknown>;
  return DATA_KEY in source ? { ...props, [DATA_KEY]: source[DATA_KEY] } : props;
}

const DEFINITIONS: BlockDefinition[] = [
  {
    type: CONTENT_WIDGET,
    version: 1,
    title: "Content",
    description: "A title and rich text.",
    icon: "¶",
    category: "widgets",
    schema: {
      title: { type: "text", label: "Title", default: "" },
      text: { type: "richtext", label: "Text", default: "" },
    },
    validateProps: (raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      return { title: str(row.title), text: typeof row.text === "string" ? row.text : "" };
    },
    render: (props) => {
      const body = sanitizeRichText(String(props.text ?? ""));
      if (!props.title && !body.trim()) return "";
      return `<section class="jf-widget jf-widget--content">${title(String(props.title ?? ""))}<div class="jf-widget__body">${body}</div></section>`;
    },
  },
  {
    type: MENU_WIDGET,
    version: 1,
    title: "Menu",
    description: "One of the site's menus as a list of links.",
    icon: "☰",
    category: "widgets",
    schema: {
      title: { type: "text", label: "Title", default: "" },
      menu: { type: "select", label: "Menu", default: "", optionsUrl: "/api/widgets/options/menus" },
    },
    validateProps: (raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      return keepData(raw, { title: str(row.title), menu: str(row.menu, 120) });
    },
    render: (props) => {
      const items = data<WidgetMenuItem[]>(props) ?? [];
      if (!items.length) return "";
      const label = String(props.title ?? "") || "Menu";
      return `<nav class="jf-widget jf-widget--menu" aria-label="${esc(label)}">${title(String(props.title ?? ""))}${menuList(items)}</nav>`;
    },
  },
  {
    type: RECENT_POSTS_WIDGET,
    version: 1,
    title: "Recent posts",
    description: "The newest posts in the visitor's language.",
    icon: "🗞",
    category: "widgets",
    schema: {
      title: { type: "text", label: "Title", default: "Recent posts" },
      count: { type: "number", label: "Number of posts", default: 5 },
      showDate: { type: "boolean", label: "Show date", default: true },
    },
    validateProps: (raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      return keepData(raw, {
        title: typeof row.title === "string" ? str(row.title) : "Recent posts",
        count: count(row.count, 5),
        showDate: bool(row.showDate, true),
      });
    },
    render: (props) => {
      const posts = data<WidgetPost[]>(props) ?? [];
      if (!posts.length) return "";
      const rows = posts
        .map(
          (post) =>
            `<li><a href="${esc(safeHref(post.href))}">${esc(post.title)}</a>${
              props.showDate && post.date ? ` <span class="jf-widget__meta">${esc(post.date)}</span>` : ""
            }</li>`,
        )
        .join("");
      return `<section class="jf-widget jf-widget--recent-posts">${title(String(props.title ?? ""))}<ul class="jf-widget__list">${rows}</ul></section>`;
    },
  },
  {
    type: SEARCH_WIDGET,
    version: 1,
    title: "Search",
    description: "A search box that opens the site's search results.",
    icon: "⌕",
    category: "widgets",
    schema: {
      title: { type: "text", label: "Title", default: "" },
      placeholder: { type: "text", label: "Placeholder", default: "Search…" },
      buttonLabel: { type: "text", label: "Button label", default: "Search" },
    },
    validateProps: (raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      return keepData(raw, {
        title: str(row.title),
        placeholder: typeof row.placeholder === "string" ? str(row.placeholder, 120) : "Search…",
        buttonLabel: str(row.buttonLabel, 60) || "Search",
      });
    },
    render: (props) => {
      const action = data<string>(props) || "/search";
      const button = String(props.buttonLabel ?? "Search");
      return (
        `<section class="jf-widget jf-widget--search">${title(String(props.title ?? ""))}` +
        `<form class="jf-widget__search" role="search" method="get" action="${esc(safeHref(action))}">` +
        `<input type="search" name="q" maxlength="200" placeholder="${esc(String(props.placeholder ?? ""))}" aria-label="${esc(button)}">` +
        `<button type="submit">${esc(button)}</button></form></section>`
      );
    },
  },
];

/** Register the core widgets once, like the template blocks. */
export function registerCoreWidgets(): void {
  const registry = getRuntimeBlockRegistry();
  for (const def of DEFINITIONS) {
    if (!registry.get(def.type)) registry.register(def);
  }
}

/**
 * Attach each core widget's data to its props for one render. Menus and post
 * lists are loaded once per distinct menu or count, however many widgets use them.
 */
export async function withCoreWidgetData(
  blocks: BlockNode[],
  source: CoreWidgetDataSource,
): Promise<BlockNode[]> {
  const menus = new Map<string, Promise<WidgetMenuItem[]>>();
  const posts = new Map<number, Promise<WidgetPost[]>>();

  async function attach(block: BlockNode): Promise<BlockNode> {
    const children = block.children?.length ? await Promise.all(block.children.map(attach)) : block.children;
    const props = block.props ?? {};
    let value: unknown;
    if (block.type === MENU_WIDGET) {
      const slug = str(props.menu, 120);
      if (slug) {
        if (!menus.has(slug)) menus.set(slug, source.menu(slug).catch(() => []));
        value = await menus.get(slug);
      }
    } else if (block.type === RECENT_POSTS_WIDGET) {
      const limit = count(props.count, 5);
      if (!posts.has(limit)) posts.set(limit, source.recentPosts(limit).catch(() => []));
      value = await posts.get(limit);
    } else if (block.type === SEARCH_WIDGET) {
      value = source.searchAction();
    }
    const next: BlockNode = value === undefined ? block : { ...block, props: { ...props, [DATA_KEY]: value } };
    return children === block.children ? next : { ...next, children };
  }

  return Promise.all(blocks.map(attach));
}

