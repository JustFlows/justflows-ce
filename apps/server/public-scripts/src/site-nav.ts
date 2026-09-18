declare global {
  interface Window {
    __jfSiteNavGeneration?: number;
  }
}

(function () {
  "use strict";

  // Only the most recent run of this script owns the delegated listeners —
  // same idempotent-reinit convention as site-chrome.ts.
  const generation = ((window.__jfSiteNavGeneration || 0) + 1) | 0;
  window.__jfSiteNavGeneration = generation;
  function current(): boolean {
    return window.__jfSiteNavGeneration === generation;
  }

  const OPEN_DELAY = 60;
  const CLOSE_DELAY = 250;
  const hoverTimers = new WeakMap<Element, number>();

  /** `event.target` is `EventTarget | null`, which has no `.closest` — every
   *  delegated listener below needs this instead of a raw `.closest` call. */
  function closestSafe(target: EventTarget | null, selector: string): HTMLElement | null {
    if (!target || !(target instanceof Element)) return null;
    return target.closest<HTMLElement>(selector);
  }

  function panelFor(trigger: HTMLElement): HTMLElement | null {
    const id = trigger.getAttribute("aria-controls");
    return id ? document.getElementById(id) : null;
  }

  function navRootFor(el: HTMLElement): HTMLElement | null {
    return el.closest<HTMLElement>("[data-jf-nav]");
  }

  function activationFor(trigger: HTMLElement): string {
    const root = navRootFor(trigger);
    return (root && root.getAttribute("data-jf-nav-activation")) || "hover";
  }

  function isOpen(trigger: HTMLElement): boolean {
    return trigger.getAttribute("aria-expanded") === "true";
  }

  /** Every trigger whose panel contains `el`, root-most first. */
  function ancestorTriggers(el: HTMLElement): HTMLElement[] {
    const chain: HTMLElement[] = [];
    let item = el.closest<HTMLElement>(".jf-nav__item");
    while (item) {
      const trigger = item.querySelector<HTMLElement>(":scope > .jf-nav__row > .jf-nav__trigger");
      if (trigger) chain.unshift(trigger);
      const parentPanel =
        item.parentElement && item.parentElement.closest<HTMLElement>(".jf-nav__submenu, .jf-nav__megapanel");
      item = parentPanel ? parentPanel.closest<HTMLElement>(".jf-nav__item") : null;
    }
    return chain;
  }

  function setOpen(trigger: HTMLElement, open: boolean): void {
    const panel = panelFor(trigger);
    if (!panel) return;
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) panel.removeAttribute("hidden");
    else panel.setAttribute("hidden", "");
  }

  function closeSiblings(trigger: HTMLElement): void {
    const item = trigger.closest<HTMLElement>(".jf-nav__item");
    const list = item && item.parentElement;
    if (!list) return;
    const siblings = list.querySelectorAll<HTMLElement>(
      ":scope > .jf-nav__item > .jf-nav__row > .jf-nav__trigger",
    );
    for (let i = 0; i < siblings.length; i++) {
      if (siblings[i] !== trigger) closeAll(siblings[i]!);
    }
  }

  /** Close a trigger and every trigger nested inside its own panel. */
  function closeAll(trigger: HTMLElement): void {
    const panel = panelFor(trigger);
    setOpen(trigger, false);
    if (panel) {
      const nested = panel.querySelectorAll<HTMLElement>(".jf-nav__trigger");
      for (let i = 0; i < nested.length; i++) setOpen(nested[i]!, false);
    }
  }

  function flipOverflow(trigger: HTMLElement): void {
    const panel = panelFor(trigger);
    if (!panel) return;
    const isMega = panel.classList.contains("jf-nav__megapanel");
    const edgeClass = isMega ? "jf-nav__megapanel--edge" : "jf-nav__submenu--edge";
    const clampClass = isMega ? "jf-nav__megapanel--clamp" : "jf-nav__submenu--clamp";
    panel.classList.remove(edgeClass, clampClass);
    panel.style.top = "";
    // A full-bleed panel is pinned to the viewport (position: fixed) so it no
    // longer flows under its trigger — anchor its top to the trigger's bottom.
    if (panel.classList.contains("jf-nav__panel--viewport")) {
      panel.style.top = Math.round(trigger.getBoundingClientRect().bottom + 4) + "px";
      return;
    }
    // A nested (second-level+) flyout opens sideways, not downward — the
    // edge/clamp rules target top-level panels; skip them here.
    const parentPanel =
      panel.parentElement && panel.parentElement.closest(".jf-nav__submenu, .jf-nav__megapanel");
    if (parentPanel) return;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    let rect = panel.getBoundingClientRect();
    // 1px tolerance only — a panel that legitimately sits flush with the left
    // edge (a left-aligned top nav) must NOT count as overflowing.
    const overflowsRight = rect.right > viewportWidth + 1;
    const overflowsLeft = rect.left < -1;
    if (overflowsRight && !overflowsLeft) {
      // Re-anchor to the trigger's right edge, then re-measure: if it still
      // does not fit (panel wider than the room to its left), fall through to
      // the viewport clamp below.
      panel.classList.add(edgeClass);
      rect = panel.getBoundingClientRect();
      if (rect.left >= -1 && rect.right <= viewportWidth + 1) return;
      panel.classList.remove(edgeClass);
    }
    if (overflowsRight || overflowsLeft) {
      // Last resort: pin the panel to the viewport (position: fixed via the
      // clamp class) so it can never sit out of bounds, and place its top just
      // under the trigger since a fixed element no longer flows from it.
      const triggerRect = trigger.getBoundingClientRect();
      panel.classList.add(clampClass);
      panel.style.top = Math.round(triggerRect.bottom + 4) + "px";
    }
  }

  function openWithAncestors(trigger: HTMLElement): void {
    const chain = ancestorTriggers(trigger).concat([trigger]);
    for (let i = 0; i < chain.length; i++) {
      closeSiblings(chain[i]!);
      setOpen(chain[i]!, true);
    }
    flipOverflow(trigger);
  }

  function toggle(trigger: HTMLElement): void {
    if (isOpen(trigger)) closeAll(trigger);
    else openWithAncestors(trigger);
  }

  function clearHoverTimer(el: Element): void {
    const t = hoverTimers.get(el);
    if (t) {
      window.clearTimeout(t);
      hoverTimers.delete(el);
    }
  }

  function scheduleHover(el: Element, fn: () => void, delay: number): void {
    clearHoverTimer(el);
    hoverTimers.set(
      el,
      window.setTimeout(() => {
        hoverTimers.delete(el);
        fn();
      }, delay),
    );
  }

  // ── Mobile menu (hamburger) ──
  // The <ul> carries `data-jf-nav-mobile` (pattern), `data-jf-nav-breakpoint`,
  // `data-jf-nav-motion` and `data-jf-nav-motion-ms`. `.jf-nav--mobile` is added
  // here ONLY while the viewport is at/below the breakpoint — every mobile CSS
  // rule is gated on it, so nothing leaks to desktop. Open/close is two-phase
  // (`.jf-nav--anim-in` a frame later) so the drawer can transition.

  const OVERLAY: Record<string, 1> = { "drawer-left": 1, "drawer-right": 1, fullscreen: 1 };

  function mobileLists(): NodeListOf<HTMLElement> {
    return document.querySelectorAll<HTMLElement>('.jf-nav[data-jf-nav-mobile]:not([data-jf-nav-mobile=""])');
  }
  function backdropFor(list: HTMLElement | null): HTMLElement | null {
    return list && list.id ? document.getElementById(list.id.replace(/-list$/, "-backdrop")) : null;
  }
  function toggleForList(list: HTMLElement | null): HTMLElement | null {
    return list && list.id ? document.getElementById(list.id.replace(/-list$/, "-toggle")) : null;
  }
  function patternOf(list: HTMLElement | null): string {
    return list ? list.getAttribute("data-jf-nav-mobile") || "" : "";
  }
  function isOverlay(list: HTMLElement | null): boolean {
    return OVERLAY[patternOf(list)] === 1;
  }
  function isMobileOpen(list: HTMLElement | null): boolean {
    return Boolean(list && list.classList.contains("jf-nav--mobile") && list.classList.contains("jf-nav--open"));
  }
  function reducedMotion(): boolean {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function motionMs(list: HTMLElement): number {
    if (reducedMotion() || list.getAttribute("data-jf-nav-motion") === "none") return 0;
    const ms = parseInt(list.getAttribute("data-jf-nav-motion-ms") || "", 10);
    return isFinite(ms) && ms > 0 ? ms : 240;
  }

  /** Move a node to <body> (behind a placeholder comment) so `position: fixed`
   *  is viewport-relative — the header's `backdrop-filter` is a fixed-pos trap. */
  const placeholders = new WeakMap<Element, Comment>();
  function portalOut(el: Element | null): void {
    if (!el || placeholders.has(el)) return;
    const ph = document.createComment("jf-nav-portal");
    placeholders.set(el, ph);
    if (el.parentNode) el.parentNode.insertBefore(ph, el);
    document.body.appendChild(el);
  }
  function portalIn(el: Element | null): void {
    const ph = el && placeholders.get(el);
    if (!ph) return;
    placeholders.delete(el!);
    if (ph.parentNode) ph.parentNode.replaceChild(el!, ph);
    else if (el!.parentNode) el!.parentNode.removeChild(el!);
  }

  function refreshScrollLock(): void {
    const lists = mobileLists();
    let lock = false;
    for (let i = 0; i < lists.length; i++) {
      if (isMobileOpen(lists[i]!) && isOverlay(lists[i]!)) lock = true;
    }
    document.body.classList.toggle("jf-nav-scroll-lock", lock);
  }

  const closeTimers = new WeakMap<HTMLElement, number>();
  function isClosing(list: HTMLElement): boolean {
    return Boolean(closeTimers.get(list));
  }

  function openMobile(list: HTMLElement | null): void {
    // Bail only if fully open (no close animation in flight).
    if (!list || (isMobileOpen(list) && !closeTimers.get(list))) return;
    const toggleBtn = toggleForList(list);
    const backdrop = backdropFor(list);
    const overlay = isOverlay(list);

    const t = closeTimers.get(list);
    if (t) {
      window.clearTimeout(t);
      closeTimers.delete(list);
    }

    if (overlay) {
      portalOut(backdrop);
      portalOut(list);
    }
    if (backdrop) backdrop.removeAttribute("hidden");
    list.classList.add("jf-nav--open");
    if (toggleBtn) toggleBtn.setAttribute("aria-expanded", "true");
    refreshScrollLock();

    // Next frame: flip to the resting position so the transition runs.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        list.classList.add("jf-nav--anim-in");
        if (backdrop) backdrop.classList.add("jf-nav--anim-in");
      });
    });

    const focusTarget =
      (overlay && list.querySelector<HTMLElement>(".jf-nav__close")) ||
      list.querySelector<HTMLElement>(".jf-nav__item .jf-nav__link, .jf-nav__item .jf-nav__trigger");
    if (focusTarget) {
      try {
        focusTarget.focus({ preventScroll: true });
      } catch (e) {
        focusTarget.focus();
      }
    }
  }

  function finalizeClose(list: HTMLElement): void {
    const toggleBtn = toggleForList(list);
    const backdrop = backdropFor(list);
    list.classList.remove("jf-nav--open", "jf-nav--anim-in");
    if (backdrop) {
      backdrop.classList.remove("jf-nav--anim-in");
      backdrop.setAttribute("hidden", "");
    }
    if (toggleBtn) toggleBtn.setAttribute("aria-expanded", "false");
    const nested = list.querySelectorAll<HTMLElement>('.jf-nav__trigger[aria-expanded="true"]');
    for (let i = 0; i < nested.length; i++) setOpen(nested[i]!, false);
    portalIn(list);
    portalIn(backdrop);
    refreshScrollLock();
  }

  function closeMobile(list: HTMLElement | null, immediate?: boolean): void {
    if (!list || !list.classList.contains("jf-nav--open")) return;
    const backdrop = backdropFor(list);
    const ms = immediate ? 0 : motionMs(list);
    list.classList.remove("jf-nav--anim-in");
    if (backdrop) backdrop.classList.remove("jf-nav--anim-in");

    const prev = closeTimers.get(list);
    if (prev) window.clearTimeout(prev);
    if (ms <= 0) {
      finalizeClose(list);
      return;
    }
    closeTimers.set(
      list,
      window.setTimeout(() => {
        closeTimers.delete(list);
        finalizeClose(list);
      }, ms + 40),
    );
  }

  function closeAllMobile(immediate?: boolean): void {
    const lists = mobileLists();
    for (let i = 0; i < lists.length; i++) {
      if (lists[i]!.classList.contains("jf-nav--open")) closeMobile(lists[i]!, immediate);
    }
  }

  /** Add/remove `.jf-nav--mobile` per viewport width; closing any menu that is
   *  open when it stops being mobile. */
  function syncMobile(): void {
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const lists = mobileLists();
    for (let i = 0; i < lists.length; i++) {
      const list = lists[i]!;
      const bp = parseInt(list.getAttribute("data-jf-nav-breakpoint") || "", 10) || 768;
      const wantMobile = list.getAttribute("data-jf-nav-layout") === "drawer" || vw <= bp;
      if (wantMobile) {
        list.classList.add("jf-nav--mobile");
      } else if (list.classList.contains("jf-nav--mobile")) {
        if (list.classList.contains("jf-nav--open")) {
          const prev = closeTimers.get(list);
          if (prev) window.clearTimeout(prev);
          finalizeClose(list);
        }
        list.classList.remove("jf-nav--mobile");
      }
    }
  }

  /** Focusable link/trigger controls at one menu level, in DOM order. */
  function levelControls(container: Element): HTMLElement[] {
    return Array.prototype.slice.call(
      container.querySelectorAll(
        ":scope > .jf-nav__item > .jf-nav__row > .jf-nav__link, :scope > .jf-nav__item > .jf-nav__row > .jf-nav__trigger",
      ),
    );
  }

  function focusOffset(el: HTMLElement, offset: number): void {
    const container = el.closest("ul");
    if (!container) return;
    const controls = levelControls(container);
    const idx = controls.indexOf(el);
    if (idx === -1) return;
    const next = controls[(idx + offset + controls.length) % controls.length];
    if (next) next.focus();
  }

  /** The open mobile list, if any. */
  function openMobileList(): HTMLElement | null {
    const lists = mobileLists();
    for (let i = 0; i < lists.length; i++) {
      if (lists[i]!.classList.contains("jf-nav--open")) return lists[i]!;
    }
    return null;
  }

  function onReady(): void {
    syncMobile();

    document.addEventListener("click", (event) => {
      if (!current()) return;
      const t = event.target;

      const toggleBtn = closestSafe(t, ".jf-nav__toggle");
      if (toggleBtn) {
        const list = document.getElementById(toggleBtn.getAttribute("aria-controls") || "");
        if (list && list.classList.contains("jf-nav--mobile")) {
          if (list.classList.contains("jf-nav--open") && !isClosing(list)) closeMobile(list);
          else openMobile(list);
        }
        return;
      }

      // Explicit close button inside the panel, or the dim backdrop.
      if (closestSafe(t, "[data-jf-nav-close]") || closestSafe(t, ".jf-nav__backdrop")) {
        closeAllMobile();
        return;
      }

      const trigger = closestSafe(t, ".jf-nav__trigger");
      if (trigger) {
        toggle(trigger);
        return;
      }

      // A link inside an open mobile menu: let navigation proceed, but close.
      const navLink = closestSafe(t, ".jf-nav__link");
      if (navLink) {
        const host = navLink.closest<HTMLElement>(".jf-nav--mobile.jf-nav--open");
        if (host) closeMobile(host);
      }

      // Click anywhere outside the open panel + its toggle closes it. Covers the
      // dropdown / accordion patterns, which have no backdrop.
      const openList = openMobileList();
      if (openList) {
        const insidePanel = closestSafe(t, "#" + openList.id);
        const onToggle = closestSafe(t, "#" + openList.id.replace(/-list$/, "-toggle"));
        if (!insidePanel && !onToggle) closeMobile(openList);
      }

      // Desktop: click outside closes any hover/click flyout.
      if (!(t instanceof Element) || !navRootFor(t as HTMLElement)) {
        const openTriggers = document.querySelectorAll<HTMLElement>('.jf-nav__trigger[aria-expanded="true"]');
        for (let i = 0; i < openTriggers.length; i++) closeAll(openTriggers[i]!);
      }
    });

    // Keep `.jf-nav--mobile` in sync with the viewport (closes a menu that is
    // open when the window grows past the breakpoint).
    let resizeRaf = 0;
    window.addEventListener("resize", () => {
      if (!current()) return;
      if (resizeRaf) return;
      resizeRaf = window.requestAnimationFrame(() => {
        resizeRaf = 0;
        syncMobile();
      });
    });
    window.addEventListener("orientationchange", () => {
      if (current()) syncMobile();
    });

    document.addEventListener(
      "mouseenter",
      (event) => {
        if (!current()) return;
        const item = closestSafe(event.target, ".jf-nav__item");
        if (!item) return;
        const activation = activationFor(item);
        if (activation !== "hover" && activation !== "both") return;
        const trigger = item.querySelector<HTMLElement>(":scope > .jf-nav__row > .jf-nav__trigger");
        if (!trigger) return;
        clearHoverTimer(item);
        scheduleHover(
          item,
          () => {
            openWithAncestors(trigger);
          },
          OPEN_DELAY,
        );
      },
      true,
    );

    document.addEventListener(
      "mouseleave",
      (event) => {
        if (!current()) return;
        const item = closestSafe(event.target, ".jf-nav__item");
        if (!item) return;
        const activation = activationFor(item);
        if (activation !== "hover" && activation !== "both") return;
        const trigger = item.querySelector<HTMLElement>(":scope > .jf-nav__row > .jf-nav__trigger");
        if (!trigger) return;
        clearHoverTimer(item);
        scheduleHover(
          item,
          () => {
            closeAll(trigger);
          },
          CLOSE_DELAY,
        );
      },
      true,
    );

    document.addEventListener("keydown", (event) => {
      if (!current()) return;

      if (event.key === "Escape") {
        // A nested flyout inside an open mobile menu closes first; then the menu.
        const mobileList = openMobileList();
        const target = document.activeElement as HTMLElement | null;
        const chain = target ? ancestorTriggers(target) : [];
        const openTrig = chain.length
          ? chain[chain.length - 1]!
          : mobileList
            ? null
            : document.querySelector<HTMLElement>('.jf-nav__trigger[aria-expanded="true"]');
        if (openTrig) {
          closeAll(openTrig);
          openTrig.focus();
          event.stopPropagation();
          return;
        }
        if (mobileList) {
          const mt = toggleForList(mobileList);
          closeMobile(mobileList);
          if (mt) mt.focus();
          event.stopPropagation();
        }
        return;
      }

      const control = closestSafe(event.target, ".jf-nav__link, .jf-nav__trigger");
      if (!control) return;

      const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
      const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
      if (!horizontal && !vertical) return;

      const container = control.closest("ul");
      const isTopLevel = Boolean(container && container.hasAttribute("data-jf-nav"));
      const isVerticalList =
        isTopLevel &&
        Boolean(container!.getAttribute("data-jf-nav-layout")) &&
        (container!.getAttribute("data-jf-nav-layout") === "vertical" ||
          container!.getAttribute("data-jf-nav-layout") === "drawer");

      if ((isTopLevel && !isVerticalList && horizontal) || (!isTopLevel && vertical) || (isVerticalList && vertical)) {
        event.preventDefault();
        focusOffset(control, event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady);
  } else {
    onReady();
  }
})();

export {};
