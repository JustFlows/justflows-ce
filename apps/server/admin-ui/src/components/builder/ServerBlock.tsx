// SPDX-License-Identifier: MIT
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { coreBlocks, hasMath, INLINE_FIELD_ATTRIBUTE } from "@justflows/blocks";
import { loadMathRenderer, useMathReady } from "../../lib/math-loader";

/**
 * Core blocks drawn by the public renderer itself (justflows-ce#311).
 *
 * The canvas used to keep a React copy of every core block, so each block
 * and setting was written twice and any gap showed as a canvas/public
 * difference. Blocks in {@link SERVER_RENDERED_TYPES} are drawn with the
 * block's own `render` from `@justflows/blocks`, the function the server
 * calls for the page, run here in the browser with no request. The builder's
 * selection, toolbar and drop zones stay around it, as for plugin blocks.
 *
 * Child blocks stay React components, so they can still be selected, edited
 * and dropped on: the block is rendered with a slot where its children go,
 * and the children are mounted into that slot through a portal. The slot is
 * one element kept across re-renders, so changing the parent's settings does
 * not remount its children, and it uses `display: contents`, so it does not
 * change the layout.
 *
 * What the canvas changes on purpose, so the block can be edited:
 * - a Details block is always open, so its content can be reached;
 * - background videos do not autoplay;
 * - a Spacer gets a striped fill (builder CSS), because the page draws it empty;
 * - a Grid being edited is a plain box, because the grid editor inside it
 *   lays the items out on its own tracks with placement handles;
 * - an empty Code, Custom HTML or Link list block shows a short hint
 *   (`hint`), so it can still be found and selected.
 * Links and buttons stay inert, as for every block on the canvas.
 *
 * In-place editing works on the elements the renderer marks with
 * `data-jf-inline="<field>"`, as for plugin blocks: while the block is
 * selected, the canvas empties each marked element and mounts its editor
 * there (`inline`). The caller renders the block with stand-in values for
 * those fields while it is selected, so committing one field does not
 * redraw the markup under an editor that is still open.
 */

/** Moved in batches, simplest first; blocks with inline fields and media replacement come last. */
export const SERVER_RENDERED_TYPES = new Set([
  "core.divider",
  "core.spacer",
  "core.callout",
  "core.details",
  "core.cover",
  "core.media-text",
  "core.features",
  "core.link-list",
  "core.code",
  "core.html",
  "core.list",
  "core.list-item",
  "core.accordion",
  "core.buttons",
  "core.card",
  "core.icon",
  "core.table",
  "core.tabs",
  "core.tab",
  "core.social-links",
  "core.section",
  "core.container",
  "core.group",
  "core.columns",
  "core.column",
  "core.grid",
  "core.heading",
  "core.paragraph",
  "core.quote",
  "core.button",
  "core.hero",
  "core.cta",
]);


/** How the in-place editor for one field is drawn: a block or an inline element, matching where it sits. */
export type InlineEditorTag = "div" | "span";
const BLOCK_HOSTS = new Set(["DIV", "BLOCKQUOTE", "SECTION", "LI", "FIGURE", "ASIDE", "ARTICLE"]);

const SLOT_ATTRIBUTE = "data-jf-children-slot";
const SLOT_HTML = `<div ${SLOT_ATTRIBUTE}=""></div>`;
const definitions = new Map(coreBlocks.map((definition) => [definition.type, definition]));

/** The block's public HTML, with a slot for its children when it has any. */
export function serverBlockHtml(type: string, props: Record<string, unknown>, withChildren: boolean): string {
  const definition = definitions.get(type);
  if (!definition) return "";
  return String(definition.render(definition.validateProps(props) as never, withChildren ? SLOT_HTML : "") ?? "");
}

/**
 * The block's chrome on its own root element, as `withBlockChrome` puts it on
 * the page: the canvas id, the preset class and the style declarations,
 * appended to the root's own inline style.
 */
function applyChrome(root: Element | null, blockId: string | undefined, rootClass: string | undefined, declarations: string | undefined): void {
  if (!(root instanceof HTMLElement)) return;
  if (blockId) root.setAttribute("data-jf-block-preview", blockId);
  for (const name of (rootClass ?? "").split(/\s+/).filter(Boolean)) root.classList.add(name);
  for (const part of (declarations ?? "").split(";")) {
    const at = part.indexOf(":");
    if (at <= 0) continue;
    const name = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (name && value) root.style.setProperty(name, value);
  }
}

/** Editor adjustments listed above, applied after each render. */
function prepareForEditing(root: HTMLElement): void {
  root.querySelectorAll("details").forEach((details) => {
    details.open = true;
    details.setAttribute("data-jf-preview-open", "true");
  });
  root.querySelectorAll("video[autoplay]").forEach((video) => {
    video.removeAttribute("autoplay");
    (video as HTMLVideoElement).autoplay = false;
  });
}

function declarationStyle(declarations: string): CSSProperties {
  const out: Record<string, string> = {};
  for (const part of declarations.split(";")) {
    const at = part.indexOf(":");
    if (at <= 0) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key && value) out[key.startsWith("--") ? key : key.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())] = value;
  }
  return out as CSSProperties;
}

export default function ServerBlock({
  type,
  props,
  children,
  hint,
  blockId,
  rootClass,
  rootDeclarations,
  inline,
}: {
  type: string;
  props: Record<string, unknown>;
  /** Child blocks, rendered by the canvas. */
  children?: ReactNode;
  /** Shown instead of the block while it has nothing to show. */
  hint?: ReactNode;
  /** Canvas id, put on the rendered root so selection and resize find it. */
  blockId?: string;
  /** Style preset class for the rendered root. */
  rootClass?: string;
  /** The block's style declarations (`blockStyleDeclarations`) for the rendered root. */
  rootDeclarations?: string;
  /** In-place editors by field, mounted into the elements marked with that field. */
  inline?: (field: string, as: InlineEditorTag) => ReactNode;
}) {
  const definition = definitions.get(type);
  const withChildren = Boolean(definition?.supportsChildren);
  /** Formulas show their source until KaTeX has loaded; the block redraws once it has (justflows-ce#318). */
  const mathReady = useMathReady();
  const html = useMemo(() => serverBlockHtml(type, props, withChildren), [type, props, withChildren, mathReady]);
  const [editors, setEditors] = useState<Array<{ field: string; host: HTMLElement; as: InlineEditorTag }>>([]);
  const editing = Boolean(inline);
  const root = useRef<HTMLDivElement | null>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const showHint = Boolean(hint);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element || showHint) return;
    element.innerHTML = html;
    if (hasMath(html) && html.includes("jf-math--pending")) void loadMathRenderer();
    prepareForEditing(element);
    applyChrome(element.firstElementChild, blockId, rootClass, rootDeclarations);
    /** Marked fields of this block only: child blocks are not in the markup yet. */
    const hosts = editing ? [...element.querySelectorAll<HTMLElement>(`[${INLINE_FIELD_ATTRIBUTE}]`)] : [];
    setEditors(
      hosts.map((host) => {
        const as: InlineEditorTag = BLOCK_HOSTS.has(host.tagName) ? "div" : "span";
        host.replaceChildren();
        return { field: host.getAttribute(INLINE_FIELD_ATTRIBUTE) ?? "", host, as };
      }),
    );
    if (!withChildren) return;
    const placeholder = element.querySelector(`[${SLOT_ATTRIBUTE}]`);
    if (!slotRef.current) {
      const created = document.createElement("div");
      created.setAttribute(SLOT_ATTRIBUTE, "");
      created.style.display = "contents";
      slotRef.current = created;
    }
    if (placeholder) placeholder.replaceWith(slotRef.current);
    setSlot(slotRef.current);
  }, [html, withChildren, showHint, blockId, rootClass, rootDeclarations, editing]);

  if (showHint) {
    return (
      <div data-jf-block-preview={blockId} className={rootClass || undefined} style={rootDeclarations ? declarationStyle(rootDeclarations) : undefined}>
        {hint}
      </div>
    );
  }
  return (
    <>
      <div ref={root} data-jf-server-block={type} />
      {slot && withChildren ? createPortal(children, slot) : null}
      {inline ? editors.map(({ field, host, as }) => createPortal(inline(field, as), host, field)) : null}
    </>
  );
}
