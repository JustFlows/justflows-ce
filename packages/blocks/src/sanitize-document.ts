// SPDX-License-Identifier: MIT

import { sanitizeHtmlBlock, sanitizeRichText } from "./sanitize.js";
import { sanitizeHref, sanitizeMediaSrc } from "./safe-url.js";

interface BlockLike {
  type?: unknown;
  props?: unknown;
  children?: unknown;
  [key: string]: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function sanitizeProps(type: string, props: Record<string, unknown>): Record<string, unknown> {
  const next = { ...props };

  if (type === "core.paragraph" || type === "core.quote") {
    if (typeof next["text"] === "string") next["text"] = sanitizeRichText(next["text"]);
  }
  if (type === "core.html" && typeof next["html"] === "string") {
    next["html"] = sanitizeHtmlBlock(next["html"]);
  }
  if ((type === "core.button" || type === "core.embed") && typeof next["url"] === "string") {
    next["url"] = sanitizeHref(next["url"]);
  }
  if (type === "core.cta" || type === "core.hero") {
    if (typeof next["buttonUrl"] === "string") next["buttonUrl"] = sanitizeHref(next["buttonUrl"]);
    if (typeof next["backgroundImage"] === "string") {
      next["backgroundImage"] = sanitizeMediaSrc(next["backgroundImage"]);
    }
  }
  if (type === "core.image" && typeof next["src"] === "string") {
    next["src"] = sanitizeMediaSrc(next["src"]);
  }

  return next;
}

function sanitizeNode(node: unknown): unknown {
  if (!node || typeof node !== "object") return node;
  const n = node as BlockLike;
  const type = typeof n.type === "string" ? n.type : "";
  const props = sanitizeProps(type, asRecord(n.props));
  const children = Array.isArray(n.children) ? n.children.map(sanitizeNode) : n.children;
  return { ...n, props, children };
}

/** Sanitize a stored block document before it is written to the database. */
export function sanitizeBlockDocument(input: unknown): { version: 1; blocks: unknown[] } {
  if (!input || typeof input !== "object") return { version: 1, blocks: [] };
  const doc = input as { blocks?: unknown };
  const blocks = Array.isArray(doc.blocks) ? doc.blocks.map(sanitizeNode) : [];
  return { version: 1, blocks };
}
