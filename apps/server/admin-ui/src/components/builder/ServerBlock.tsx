// SPDX-License-Identifier: MIT
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { coreBlocks } from "@justflows/blocks";

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
 * - an empty Code, Custom HTML or Link list block shows a short hint
 *   (`hint`), so it can still be found and selected.
 * Links and buttons stay inert, as for every block on the canvas.
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
]);

const SLOT_ATTRIBUTE = "data-jf-children-slot";
const SLOT_HTML = `<div ${SLOT_ATTRIBUTE}=""></div>`;
const definitions = new Map(coreBlocks.map((definition) => [definition.type, definition]));

/** The block's public HTML, with a slot for its children when it has any. */
export function serverBlockHtml(type: string, props: Record<string, unknown>, withChildren: boolean): string {
  const definition = definitions.get(type);
  if (!definition) return "";
  return String(definition.render(definition.validateProps(props) as never, withChildren ? SLOT_HTML : "") ?? "");
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

export default function ServerBlock({
  type,
  props,
  children,
  hint,
}: {
  type: string;
  props: Record<string, unknown>;
  /** Child blocks, rendered by the canvas. */
  children?: ReactNode;
  /** Shown instead of the block while it has nothing to show. */
  hint?: ReactNode;
}) {
  const definition = definitions.get(type);
  const withChildren = Boolean(definition?.supportsChildren);
  const html = useMemo(() => serverBlockHtml(type, props, withChildren), [type, props, withChildren]);
  const root = useRef<HTMLDivElement | null>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const showHint = Boolean(hint);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element || showHint) return;
    element.innerHTML = html;
    prepareForEditing(element);
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
  }, [html, withChildren, showHint]);

  if (showHint) return <>{hint}</>;
  return (
    <>
      <div ref={root} data-jf-server-block={type} />
      {slot && withChildren ? createPortal(children, slot) : null}
    </>
  );
}
