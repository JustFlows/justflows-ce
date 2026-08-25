import type { BlockNode } from "./types";

function newId(): string {
  return crypto.randomUUID();
}

export const DEFAULT_PROPS: Record<string, Record<string, unknown>> = {
  "core.section": { background: "default", padding: "lg", align: "left" },
  "core.container": { width: "default" },
  "core.group": {},
  "core.columns": { columns: 2, gap: "md" },
  "core.column": {},
  "core.hero": {
    heading: "Build something great",
    subheading: "A clean, modern page builder for your site.",
    buttonLabel: "Get started",
    buttonUrl: "/",
    backgroundImage: "",
    align: "center",
  },
  "core.features": {
    heading: "Features",
    columns: 3,
    items: [
      { icon: "⚡", title: "Fast", description: "Lightweight and performant." },
      { icon: "🎨", title: "Flexible", description: "Sections and blocks you control." },
      { icon: "🔒", title: "Secure", description: "Your content stays on your server." },
    ],
  },
  "core.cta": {
    heading: "Ready to get started?",
    text: "Create beautiful pages in minutes.",
    buttonLabel: "Contact us",
    buttonUrl: "/contact",
    variant: "primary",
  },
  "core.paragraph": { text: "" },
  "core.heading": { text: "", level: 2 },
  "core.image": { src: "", alt: "", caption: "" },
  "core.quote": { text: "", attribution: "" },
  "core.button": { label: "", url: "", variant: "primary" },
  "core.divider": {},
  "core.spacer": { height: 40 },
  "core.code": { code: "", language: "" },
  "core.embed": { url: "", caption: "" },
  "core.html": { html: "" },
  "justflows.forms.form": { formId: "contact" },
  "justflows.gallery.grid": { items: [], layout: "grid", columns: 3, lightbox: true },
  "core.grid": { columns: 12, gap: "md", rowHeight: "auto" },
  "core.color-scheme": { style: "buttons", align: "right", showSystem: false },
  "core.language-switcher": { style: "codes", align: "right" },
  "core.auth-links": {
    showLogin: true,
    showRegister: true,
    loginLabel: "Log in",
    registerLabel: "Register",
    style: "buttons",
    align: "right",
  },
};

function makeColumn(): BlockNode {
  return { id: newId(), type: "core.column", version: 1, props: {}, children: [] };
}

export function createBlock(type: string): BlockNode {
  const block: BlockNode = {
    id: newId(),
    type,
    version: 1,
    props: { ...(DEFAULT_PROPS[type] ?? {}) },
  };

  if (type === "core.columns") {
    const cols = (block.props.columns as number) ?? 2;
    block.children = Array.from({ length: cols }, () => makeColumn());
  }

  if (type === "core.section" || type === "core.container" || type === "core.group") {
    block.children = [];
  }

  return block;
}

export function syncColumnCount(block: BlockNode): BlockNode {
  if (block.type !== "core.columns") return block;
  const target = Math.min(4, Math.max(2, (block.props.columns as number) ?? 2));
  const children = [...(block.children ?? [])];

  while (children.length < target) children.push(makeColumn());
  while (children.length > target) children.pop();

  return { ...block, props: { ...block.props, columns: target }, children };
}

export const CATEGORY_LABELS: Record<string, string> = {
  sections: "Sections",
  layout: "Layout",
  content: "Content",
  media: "Media",
  site: "Site",
};

export const CATEGORY_ORDER = ["sections", "layout", "content", "media", "site"];
