(function () {
  "use strict";

  // Only the most recent run of this script owns the delegated listeners —
  // same idempotent-reinit convention as site-chrome.js.
  var generation = ((window.__jfSiteNavGeneration || 0) + 1) | 0;
  window.__jfSiteNavGeneration = generation;
  function current() {
    return window.__jfSiteNavGeneration === generation;
  }

  var OPEN_DELAY = 60;
  var CLOSE_DELAY = 250;
  var hoverTimers = new WeakMap();

  function panelFor(trigger) {
    var id = trigger.getAttribute("aria-controls");
    return id ? document.getElementById(id) : null;
  }

  function navRootFor(el) {
    return el.closest("[data-jf-nav]");
  }

  function activationFor(trigger) {
    var root = navRootFor(trigger);
    return (root && root.getAttribute("data-jf-nav-activation")) || "hover";
  }

  function isOpen(trigger) {
    return trigger.getAttribute("aria-expanded") === "true";
  }

  /** Every trigger whose panel contains `el`, root-most first. */
  function ancestorTriggers(el) {
    var chain = [];
    var item = el.closest(".jf-nav__item");
    while (item) {
      var trigger = item.querySelector(':scope > .jf-nav__row > .jf-nav__trigger');
      if (trigger) chain.unshift(trigger);
      var parentPanel = item.parentElement && item.parentElement.closest(".jf-nav__submenu, .jf-nav__megapanel");
      item = parentPanel ? parentPanel.closest(".jf-nav__item") : null;
    }
    return chain;
  }

  function setOpen(trigger, open) {
    var panel = panelFor(trigger);
    if (!panel) return;
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) panel.removeAttribute("hidden");
    else panel.setAttribute("hidden", "");
  }

  function closeSiblings(trigger) {
    var item = trigger.closest(".jf-nav__item");
    var list = item && item.parentElement;
    if (!list) return;
    var siblings = list.querySelectorAll(':scope > .jf-nav__item > .jf-nav__row > .jf-nav__trigger');
    for (var i = 0; i < siblings.length; i++) {
      if (siblings[i] !== trigger) closeAll(siblings[i]);
    }
  }

  /** Close a trigger and every trigger nested inside its own panel. */
  function closeAll(trigger) {
    var panel = panelFor(trigger);
    setOpen(trigger, false);
    if (panel) {
      var nested = panel.querySelectorAll(".jf-nav__trigger");
      for (var i = 0; i < nested.length; i++) setOpen(nested[i], false);
    }
  }

  function flipOverflow(trigger) {
    var panel = panelFor(trigger);
    if (!panel) return;
    var isMega = panel.classList.contains("jf-nav__megapanel");
    var edgeClass = isMega ? "jf-nav__megapanel--edge" : "jf-nav__submenu--edge";
    var clampClass = isMega ? "jf-nav__megapanel--clamp" : "jf-nav__submenu--clamp";
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
    var parentPanel = panel.parentElement && panel.parentElement.closest(".jf-nav__submenu, .jf-nav__megapanel");
    if (parentPanel) return;
    var viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    var rect = panel.getBoundingClientRect();
    // 1px tolerance only — a panel that legitimately sits flush with the left
    // edge (a left-aligned top nav) must NOT count as overflowing.
    var overflowsRight = rect.right > viewportWidth + 1;
    var overflowsLeft = rect.left < -1;
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
      var triggerRect = trigger.getBoundingClientRect();
      panel.classList.add(clampClass);
      panel.style.top = Math.round(triggerRect.bottom + 4) + "px";
    }
  }

  function openWithAncestors(trigger) {
    var chain = ancestorTriggers(trigger).concat([trigger]);
    for (var i = 0; i < chain.length; i++) {
      closeSiblings(chain[i]);
      setOpen(chain[i], true);
    }
    flipOverflow(trigger);
  }

  function toggle(trigger) {
    if (isOpen(trigger)) closeAll(trigger);
    else openWithAncestors(trigger);
  }

  function clearHoverTimer(el) {
    var t = hoverTimers.get(el);
    if (t) {
      window.clearTimeout(t);
      hoverTimers.delete(el);
    }
  }

  function scheduleHover(el, fn, delay) {
    clearHoverTimer(el);
    hoverTimers.set(
      el,
      window.setTimeout(function () {
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

  var OVERLAY = { "drawer-left": 1, "drawer-right": 1, fullscreen: 1 };

  function mobileLists() {
    return document.querySelectorAll('.jf-nav[data-jf-nav-mobile]:not([data-jf-nav-mobile=""])');
  }
  function backdropFor(list) {
    return list && list.id ? document.getElementById(list.id.replace(/-list$/, "-backdrop")) : null;
  }
  function toggleForList(list) {
    return list && list.id ? document.getElementById(list.id.replace(/-list$/, "-toggle")) : null;
  }
  function patternOf(list) {
    return list ? list.getAttribute("data-jf-nav-mobile") || "" : "";
  }
  function isOverlay(list) {
    return OVERLAY[patternOf(list)] === 1;
  }
  function isMobileOpen(list) {
    return list && list.classList.contains("jf-nav--mobile") && list.classList.contains("jf-nav--open");
  }
  function reducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function motionMs(list) {
    if (reducedMotion() || list.getAttribute("data-jf-nav-motion") === "none") return 0;
    var ms = parseInt(list.getAttribute("data-jf-nav-motion-ms"), 10);
    return isFinite(ms) && ms > 0 ? ms : 240;
  }

  /** Move a node to <body> (behind a placeholder comment) so `position: fixed`
   *  is viewport-relative — the header's `backdrop-filter` is a fixed-pos trap. */
  var placeholders = new WeakMap();
  function portalOut(el) {
    if (!el || placeholders.has(el)) return;
    var ph = document.createComment("jf-nav-portal");
    placeholders.set(el, ph);
    if (el.parentNode) el.parentNode.insertBefore(ph, el);
    document.body.appendChild(el);
  }
  function portalIn(el) {
    var ph = el && placeholders.get(el);
    if (!ph) return;
    placeholders.delete(el);
    if (ph.parentNode) ph.parentNode.replaceChild(el, ph);
    else if (el.parentNode) el.parentNode.removeChild(el);
  }

  function refreshScrollLock() {
    var lists = mobileLists();
    var lock = false;
    for (var i = 0; i < lists.length; i++) {
      if (isMobileOpen(lists[i]) && isOverlay(lists[i])) lock = true;
    }
    document.body.classList.toggle("jf-nav-scroll-lock", lock);
  }

  var closeTimers = new WeakMap();
  function isClosing(list) {
    return Boolean(closeTimers.get(list));
  }

  function openMobile(list) {
    // Bail only if fully open (no close animation in flight).
    if (!list || (isMobileOpen(list) && !closeTimers.get(list))) return;
    var toggleBtn = toggleForList(list);
    var backdrop = backdropFor(list);
    var overlay = isOverlay(list);

    var t = closeTimers.get(list);
    if (t) { window.clearTimeout(t); closeTimers.delete(list); }

    if (overlay) {
      portalOut(backdrop);
      portalOut(list);
    }
    if (backdrop) backdrop.removeAttribute("hidden");
    list.classList.add("jf-nav--open");
    if (toggleBtn) toggleBtn.setAttribute("aria-expanded", "true");
    refreshScrollLock();

    // Next frame: flip to the resting position so the transition runs.
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        list.classList.add("jf-nav--anim-in");
        if (backdrop) backdrop.classList.add("jf-nav--anim-in");
      });
    });

    var focusTarget = (overlay && list.querySelector(".jf-nav__close")) ||
      list.querySelector(".jf-nav__item .jf-nav__link, .jf-nav__item .jf-nav__trigger");
    if (focusTarget) { try { focusTarget.focus({ preventScroll: true }); } catch (e) { focusTarget.focus(); } }
  }

  function finalizeClose(list) {
    var toggleBtn = toggleForList(list);
    var backdrop = backdropFor(list);
    list.classList.remove("jf-nav--open", "jf-nav--anim-in");
    if (backdrop) {
      backdrop.classList.remove("jf-nav--anim-in");
      backdrop.setAttribute("hidden", "");
    }
    if (toggleBtn) toggleBtn.setAttribute("aria-expanded", "false");
    var nested = list.querySelectorAll('.jf-nav__trigger[aria-expanded="true"]');
    for (var i = 0; i < nested.length; i++) setOpen(nested[i], false);
    portalIn(list);
    portalIn(backdrop);
    refreshScrollLock();
  }

  function closeMobile(list, immediate) {
    if (!list || !list.classList.contains("jf-nav--open")) return;
    var backdrop = backdropFor(list);
    var ms = immediate ? 0 : motionMs(list);
    list.classList.remove("jf-nav--anim-in");
    if (backdrop) backdrop.classList.remove("jf-nav--anim-in");

    var prev = closeTimers.get(list);
    if (prev) window.clearTimeout(prev);
    if (ms <= 0) {
      finalizeClose(list);
      return;
    }
    closeTimers.set(list, window.setTimeout(function () {
      closeTimers.delete(list);
      finalizeClose(list);
    }, ms + 40));
  }

  function closeAllMobile(immediate) {
    var lists = mobileLists();
    for (var i = 0; i < lists.length; i++) {
      if (lists[i].classList.contains("jf-nav--open")) closeMobile(lists[i], immediate);
    }
  }

  /** Add/remove `.jf-nav--mobile` per viewport width; closing any menu that is
   *  open when it stops being mobile. */
  function syncMobile() {
    var vw = document.documentElement.clientWidth || window.innerWidth;
    var lists = mobileLists();
    for (var i = 0; i < lists.length; i++) {
      var list = lists[i];
      var bp = parseInt(list.getAttribute("data-jf-nav-breakpoint"), 10) || 768;
      var wantMobile = list.getAttribute("data-jf-nav-layout") === "drawer" || vw <= bp;
      if (wantMobile) {
        list.classList.add("jf-nav--mobile");
      } else if (list.classList.contains("jf-nav--mobile")) {
        if (list.classList.contains("jf-nav--open")) {
          var prev = closeTimers.get(list);
          if (prev) window.clearTimeout(prev);
          finalizeClose(list);
        }
        list.classList.remove("jf-nav--mobile");
      }
    }
  }

  /** Focusable link/trigger controls at one menu level, in DOM order. */
  function levelControls(container) {
    return Array.prototype.slice.call(
      container.querySelectorAll(':scope > .jf-nav__item > .jf-nav__row > .jf-nav__link, :scope > .jf-nav__item > .jf-nav__row > .jf-nav__trigger'),
    );
  }

  function focusOffset(el, offset) {
    var container = el.closest("ul");
    if (!container) return;
    var controls = levelControls(container);
    var idx = controls.indexOf(el);
    if (idx === -1) return;
    var next = controls[(idx + offset + controls.length) % controls.length];
    if (next) next.focus();
  }

  /** The open mobile list, if any. */
  function openMobileList() {
    var lists = mobileLists();
    for (var i = 0; i < lists.length; i++) {
      if (lists[i].classList.contains("jf-nav--open")) return lists[i];
    }
    return null;
  }

  function onReady() {
    syncMobile();

    document.addEventListener("click", function (event) {
      if (!current()) return;
      var t = event.target;

      var toggleBtn = t.closest && t.closest(".jf-nav__toggle");
      if (toggleBtn) {
        var list = document.getElementById(toggleBtn.getAttribute("aria-controls") || "");
        if (list && list.classList.contains("jf-nav--mobile")) {
          if (list.classList.contains("jf-nav--open") && !isClosing(list)) closeMobile(list);
          else openMobile(list);
        }
        return;
      }

      // Explicit close button inside the panel, or the dim backdrop.
      if (t.closest && (t.closest("[data-jf-nav-close]") || t.closest(".jf-nav__backdrop"))) {
        closeAllMobile();
        return;
      }

      var trigger = t.closest && t.closest(".jf-nav__trigger");
      if (trigger) {
        toggle(trigger);
        return;
      }

      // A link inside an open mobile menu: let navigation proceed, but close.
      var navLink = t.closest && t.closest(".jf-nav__link");
      if (navLink) {
        var host = navLink.closest(".jf-nav--mobile.jf-nav--open");
        if (host) closeMobile(host);
      }

      // Click anywhere outside the open panel + its toggle closes it. Covers the
      // dropdown / accordion patterns, which have no backdrop.
      var openList = openMobileList();
      if (openList) {
        var insidePanel = t.closest && t.closest("#" + openList.id);
        var onToggle = t.closest && t.closest("#" + openList.id.replace(/-list$/, "-toggle"));
        if (!insidePanel && !onToggle) closeMobile(openList);
      }

      // Desktop: click outside closes any hover/click flyout.
      if (!navRootFor(t)) {
        var openTriggers = document.querySelectorAll('.jf-nav__trigger[aria-expanded="true"]');
        for (var i = 0; i < openTriggers.length; i++) closeAll(openTriggers[i]);
      }
    });

    // Keep `.jf-nav--mobile` in sync with the viewport (closes a menu that is
    // open when the window grows past the breakpoint).
    var resizeRaf = 0;
    window.addEventListener("resize", function () {
      if (!current()) return;
      if (resizeRaf) return;
      resizeRaf = window.requestAnimationFrame(function () {
        resizeRaf = 0;
        syncMobile();
      });
    });
    window.addEventListener("orientationchange", function () {
      if (current()) syncMobile();
    });

    document.addEventListener(
      "mouseenter",
      function (event) {
        if (!current()) return;
        var item = event.target.closest && event.target.closest(".jf-nav__item");
        if (!item) return;
        var activation = activationFor(item);
        if (activation !== "hover" && activation !== "both") return;
        var trigger = item.querySelector(':scope > .jf-nav__row > .jf-nav__trigger');
        if (!trigger) return;
        clearHoverTimer(item);
        scheduleHover(item, function () {
          openWithAncestors(trigger);
        }, OPEN_DELAY);
      },
      true,
    );

    document.addEventListener(
      "mouseleave",
      function (event) {
        if (!current()) return;
        var item = event.target.closest && event.target.closest(".jf-nav__item");
        if (!item) return;
        var activation = activationFor(item);
        if (activation !== "hover" && activation !== "both") return;
        var trigger = item.querySelector(':scope > .jf-nav__row > .jf-nav__trigger');
        if (!trigger) return;
        clearHoverTimer(item);
        scheduleHover(item, function () {
          closeAll(trigger);
        }, CLOSE_DELAY);
      },
      true,
    );

    document.addEventListener("keydown", function (event) {
      if (!current()) return;

      if (event.key === "Escape") {
        // A nested flyout inside an open mobile menu closes first; then the menu.
        var mobileList = openMobileList();
        var target = document.activeElement;
        var chain = target ? ancestorTriggers(target) : [];
        var openTrig = chain.length
          ? chain[chain.length - 1]
          : (mobileList ? null : document.querySelector('.jf-nav__trigger[aria-expanded="true"]'));
        if (openTrig) {
          closeAll(openTrig);
          openTrig.focus();
          event.stopPropagation();
          return;
        }
        if (mobileList) {
          var mt = toggleForList(mobileList);
          closeMobile(mobileList);
          if (mt) mt.focus();
          event.stopPropagation();
        }
        return;
      }

      var control = event.target.closest && event.target.closest(".jf-nav__link, .jf-nav__trigger");
      if (!control) return;

      var horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
      var vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
      if (!horizontal && !vertical) return;

      var container = control.closest("ul");
      var isTopLevel = Boolean(container && container.hasAttribute("data-jf-nav"));
      var isVerticalList =
        isTopLevel && container.getAttribute("data-jf-nav-layout") &&
        (container.getAttribute("data-jf-nav-layout") === "vertical" ||
          container.getAttribute("data-jf-nav-layout") === "drawer");

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
