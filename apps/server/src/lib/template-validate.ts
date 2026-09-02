// SPDX-License-Identifier: MIT

/**
 * Lightweight structural check for a theme template's block document: every
 * block type it uses must be registered in the runtime block registry. Unknown
 * types are usually a plugin block whose plugin is not installed (the same
 * situation `requiresBlockTypes` warns about for patterns) or a typo. This is
 * advisory — the editor and the CLI surface it, but saving is not blocked, so a
 * template authored against a plugin that will be installed later still works.
 */

import { getRuntimeBlockRegistry } from "./runtime-blocks.js";
import type { BlockNode } from "./types.js";

export interface TemplateValidation {
  ok: boolean;
  /** Block types in the document that no registered block provides. */
  unknownBlockTypes: string[];
}

export function validateTemplateBlocks(blocks: BlockNode[]): TemplateValidation {
  const registry = getRuntimeBlockRegistry();
  const unknown = new Set<string>();

  const walk = (nodes: BlockNode[]): void => {
    for (const node of nodes) {
      if (typeof node?.type === "string" && !registry.get(node.type)) {
        unknown.add(node.type);
      }
      if (Array.isArray(node?.children)) walk(node.children);
    }
  };
  walk(Array.isArray(blocks) ? blocks : []);

  return { ok: unknown.size === 0, unknownBlockTypes: [...unknown].sort() };
}
