// SPDX-License-Identifier: MIT

import { callTool } from "../tools/registry.js";
import type { AgentTool } from "../tools/manage-tool.js";
import type { AgentPrincipal } from "../tools/principal.js";

/**
 * What the confirmation dialog shows before a write runs: a one-line summary
 * and, where the current state can be read, a field-by-field before/after.
 */

export interface PreviewChange {
  field: string;
  before: string | null;
  after: string;
}

export interface WritePreview {
  summary: string;
  changes: PreviewChange[];
}

const SECRET_ARG = /pass(word)?|secret|token|api[-_]?key/i;
const MAX_VALUE = 1_500;

function display(value: unknown): string {
  if (value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 1);
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text;
}

/** A readable digest of a block document: one line per block, nested indented. */
export function summarizeBlocks(doc: unknown, depth = 0): string {
  const blocks = Array.isArray(doc) ? doc : (doc as { blocks?: unknown })?.blocks;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((node) => {
      const record = (node ?? {}) as { type?: unknown; props?: Record<string, unknown>; children?: unknown };
      const props = record.props ?? {};
      const text = ["text", "heading", "label", "alt", "src", "url", "html", "code"]
        .map((key) => props[key])
        .find((value) => typeof value === "string" && value.trim()) as string | undefined;
      const plain = text?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) ?? "";
      const line = `${"  ".repeat(depth)}• ${String(record.type ?? "?")}${plain ? `: ${plain}` : ""}`;
      const children = Array.isArray(record.children) ? summarizeBlocks(record.children, depth + 1) : "";
      return children ? `${line}\n${children}` : line;
    })
    .join("\n");
}

function argChanges(args: Record<string, unknown>): PreviewChange[] {
  return Object.entries(args)
    .filter(([key, value]) => value !== undefined && key !== "expectedVersion")
    .map(([key, value]) => ({
      field: key,
      before: null,
      after: SECRET_ARG.test(key) ? "••••••" : key === "blocks" ? summarizeBlocks(value) : key === "base64" ? "(file contents)" : display(value),
    }));
}

export async function buildWritePreview(
  principal: AgentPrincipal,
  tool: AgentTool,
  args: Record<string, unknown>,
  meta: { ip?: string; userAgent?: string },
): Promise<WritePreview> {
  const target = tool.targetArg ? args[tool.targetArg] : undefined;
  const summary = `${tool.title}${target !== undefined ? ` (${String(target)})` : ""}`;

  // Content edits get a real diff against the entry as it is now.
  if (tool.name === "content_update" && typeof args.id === "string") {
    const current = await callTool(principal, "content_get", { id: args.id }, meta);
    if (current.outcome.ok) {
      const entry = current.outcome.data as Record<string, unknown>;
      const changes: PreviewChange[] = [];
      for (const field of ["title", "slug", "excerpt"]) {
        if (args[field] !== undefined && args[field] !== entry[field]) {
          changes.push({ field, before: display(entry[field] ?? ""), after: display(args[field]) });
        }
      }
      if (args.blocks !== undefined) {
        changes.push({ field: "blocks", before: summarizeBlocks(entry.blocks), after: summarizeBlocks(args.blocks) });
      }
      if (args.fields && typeof args.fields === "object") {
        const before = (entry.fields ?? {}) as Record<string, unknown>;
        for (const [key, value] of Object.entries(args.fields as Record<string, unknown>)) {
          if (JSON.stringify(before[key]) !== JSON.stringify(value)) {
            changes.push({ field: `fields.${key}`, before: display(before[key] ?? ""), after: display(value) });
          }
        }
      }
      return { summary: `${summary}: “${String(entry.title ?? "")}”`, changes };
    }
  }

  if (tool.name === "media_update" && typeof args.id === "string") {
    const current = await callTool(principal, "media_get", { id: args.id }, meta);
    if (current.outcome.ok) {
      const item = current.outcome.data as Record<string, unknown>;
      const changes: PreviewChange[] = [];
      if (args.altText !== undefined) changes.push({ field: "altText", before: display(item.alt_text ?? ""), after: display(args.altText) });
      if (args.caption !== undefined) changes.push({ field: "caption", before: display(item.caption ?? ""), after: display(args.caption) });
      return { summary: `${summary}: ${String(item.filename ?? "")}`, changes };
    }
  }

  return { summary, changes: argChanges(args) };
}
