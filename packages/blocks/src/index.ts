// SPDX-License-Identifier: MIT

export { BlockRegistry } from "./registry/block-registry.js";
export type { BlockDefinition, BlockSchema, FieldType, BlockRenderNode } from "./registry/block-registry.js";
export { coreBlocks } from "./core/index.js";
export { sanitizeRichText, sanitizeHtmlBlock } from "./sanitize.js";
export { sanitizeBlockDocument } from "./sanitize-document.js";
export { esc, safeHref, safeMediaSrc, sanitizeHref, sanitizeMediaSrc } from "./safe-url.js";

import { BlockRegistry } from "./registry/block-registry.js";
import { coreBlocks } from "./core/index.js";

/** Create a BlockRegistry pre-loaded with all core blocks */
export function createBlockRegistrySync(): BlockRegistry {
  const registry = new BlockRegistry();
  for (const block of coreBlocks) registry.register(block);
  return registry;
}
