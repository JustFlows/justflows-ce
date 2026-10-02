// SPDX-License-Identifier: MIT
import { useEffect } from "react";

// Plain role=status also labels loading/search progress. Only actionable notices
// should move focus. Custom notices can opt in with data-notice-focus="true";
// background updates can opt out on any ancestor with "false".
const notices = '.jf-alert, .jf-status--saved, .jf-status--error, .jf-status--warning, .jf-editor__status--ok, .jf-editor__status--error, [role="alert"], [data-notice-focus="true"]';
const excluded = '[hidden], [inert], [aria-hidden="true"], [aria-busy="true"], [data-notice-focus="false"]';

function visible(element: HTMLElement): boolean {
  if (element.closest(excluded)) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

function priority(element: HTMLElement): number {
  if (element.matches('.jf-alert--error, .jf-status--error, .jf-editor__status--error, [role="alert"]')) return 2;
  if (element.matches('.jf-alert--warning, .jf-status--warning')) return 1;
  return 0;
}

/** Shared by all app routes, including full-screen builders and portaled dialogs. */
export default function NoticeFocus() {
  useEffect(() => {
    let previous = new Map<HTMLElement, string>();
    let frame: number | undefined;

    function scan(focus: boolean) {
      const next = new Map<HTMLElement, string>();
      const changed: HTMLElement[] = [];
      for (const element of document.querySelectorAll<HTMLElement>(notices)) {
        if (!visible(element)) continue;
        const text = element.textContent?.trim();
        if (!text) continue;
        const signature = `${priority(element)}:${text}`;
        next.set(element, signature);
        if (previous.get(element) !== signature) changed.push(element);
      }
      previous = next;
      if (!focus) return;

      // Never pull keyboard focus out of a modal to a background save result.
      const dialogs = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"], dialog[open]')].filter(visible);
      const dialog = dialogs.at(-1);
      const target = changed
        .filter((element) => !dialog || dialog.contains(element))
        .sort((a, b) => priority(b) - priority(a))[0];
      if (!target || target.contains(document.activeElement)) return;
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.setAttribute("data-notice-focused", "true");
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    }

    // Existing explanatory banners should not steal initial page focus.
    scan(false);
    const observer = new MutationObserver(() => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        scan(true);
      });
    });
    observer.observe(document.body, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ["class", "role", "hidden", "inert", "aria-hidden", "aria-busy", "style", "data-notice-focus"],
    });
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
