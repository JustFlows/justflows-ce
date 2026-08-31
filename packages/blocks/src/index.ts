// SPDX-License-Identifier: MIT

export { BlockRegistry } from "./registry/block-registry.js";
export type { BlockDefinition, BlockSchema, FieldType, BlockRenderNode } from "./registry/block-registry.js";
export { coreBlocks } from "./core/index.js";
export { sanitizeRichText, sanitizeHtmlBlock, sanitizePlainText } from "./sanitize.js";
export { sanitizeBlockDocument } from "./sanitize-document.js";
export { esc, safeHref, safeMediaSrc, sanitizeHref, sanitizeMediaSrc } from "./safe-url.js";
export {
  ANIMATION_EASINGS,
  ANIMATION_TRIGGERS,
  DEFAULT_BLOCK_ANIMATION,
  ENTRANCE_EFFECTS,
  ENTRANCE_VARIANTS,
  HOVER_EFFECTS,
  HOVER_VARIANTS,
  TAP_EFFECTS,
  TAP_VARIANTS,
  blockAnimationCss,
  compactBlockAnimation,
  isActiveAnimation,
  parseBlockAnimation,
  sanitizeAnimationProp,
  withBlockAnimation,
} from "./animation.js";
export type {
  AnimationEasing,
  AnimationTrigger,
  BlockAnimation,
  EntranceEffect,
  HoverEffect,
  MotionVariant,
  TapEffect,
} from "./animation.js";
export { withBlockChrome } from "./block-chrome.js";
export {
  DEFAULT_BLOCK_PLACEMENT,
  GRID_DEFAULT_COLUMNS,
  GRID_MAX_COLUMNS,
  GRID_MIN_COLUMNS,
  compactBlockPlacement,
  isDefaultPlacement,
  isPlacementShaped,
  parseBlockPlacement,
  placementStyleVars,
  sanitizePlacementProp,
} from "./layout.js";
export type { BlockPlacement } from "./layout.js";
export {
  ALIGN_SELF,
  DEFAULT_BLOCK_STYLE,
  RADIUS_PRESETS,
  SHADOW_PRESETS,
  SPACE_STEPS,
  TEXT_ALIGN,
  WIDTH_PRESETS,
  blockStyleDeclarations,
  compactBlockStyle,
  isDefaultBlockStyle,
  parseBlockStyle,
  sanitizeBlockStyleProp,
} from "./block-style.js";
export type { BlockStyle, SpaceStep } from "./block-style.js";
export type { BlockChromeNode } from "./block-chrome.js";
export {
  blockScopeClass,
  decodeCssEscapes,
  hasUnsafeCss,
  normalizeCssForChecks,
  sanitizeBlockClassName,
  sanitizeBlockCss,
  scopeBlockCss,
  stripCssComments,
} from "./safe-css.js";

import { BlockRegistry } from "./registry/block-registry.js";
import { coreBlocks } from "./core/index.js";

/** Create a BlockRegistry pre-loaded with all core blocks */
export function createBlockRegistrySync(): BlockRegistry {
  const registry = new BlockRegistry();
  for (const block of coreBlocks) registry.register(block);
  return registry;
}
