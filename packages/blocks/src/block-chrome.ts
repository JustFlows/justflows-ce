// SPDX-License-Identifier: MIT

import { injectRootAttrs, withBlockAnimation } from "./animation.js";
import { blockScopeClass, sanitizeBlockClassName, scopeBlockCss } from "./safe-css.js";
import { isDefaultPlacement, isPlacementShaped, parseBlockPlacement, placementStyleVars } from "./layout.js";
import { blockStyleDeclarations, parseBlockStyle } from "./block-style.js";

/** The parts of a stored block that presentation reads. */
export interface BlockChromeNode {
  id?: unknown;
  props?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/**
 * Apply everything the page builder attaches to a block's rendered HTML that
 * the block's own `render` knows nothing about: animation, editor-supplied
 * classes, and the block's own CSS.
 *
 * The CSS rides along as a `<style>` element in front of the markup rather than
 * being collected into the page head. That keeps it inside the one function
 * that already has both the node and its HTML, so every render path — nested
 * children, plugin blocks, the forms block — gets it by construction instead of
 * by remembering to thread a collector through. It needs `style-src` to allow
 * inline styles, which the shipped Content-Security-Policy default does.
 */
export function withBlockChrome(html: string, node: BlockChromeNode): string {
  if (!html.trim()) return html;
  const props = asRecord(node.props);

  let out = withBlockAnimation(html, props);

  const classes: string[] = [];
  const custom = sanitizeBlockClassName(props["className"]);
  if (custom) classes.push(custom);

  const scope = blockScopeClass(node.id);
  const css = scope ? scopeBlockCss(props["css"], `.${scope}`) : "";
  if (css) classes.push(scope);

  // Grid placement and per-block spacing both ride on the item itself, and both
  // are emitted only when set, so an untouched block carries no attributes at
  // all. Placement first: it is what a media query later overrides.
  const declarations: string[] = [];
  const placementSource = props["gridPlacement"] ?? (isPlacementShaped(props["layout"]) ? props["layout"] : undefined);
  if (placementSource) {
    const placement = parseBlockPlacement(placementSource);
    if (!isDefaultPlacement(placement)) declarations.push(placementStyleVars(placement));
  }
  if (props["style"]) {
    const spacing = blockStyleDeclarations(parseBlockStyle(props["style"]));
    if (spacing) declarations.push(spacing);
  }
  const styleVars = declarations.join(";");

  if (classes.length > 0 || styleVars) out = injectRootAttrs(out, classes.join(" "), styleVars, "");

  return css ? `<style>${css}</style>\n${out}` : out;
}
