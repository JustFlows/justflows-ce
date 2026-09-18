(function () {
  "use strict";

  // Turns any server-rendered `[data-jf-toast]` element into a floating,
  // dismissible notice instead of a static block a visitor might never
  // scroll back up to see (e.g. a comment-form error after a full-page
  // submit). Any feature can opt in just by rendering the attribute — this
  // script owns positioning, animation, and dismissal; the feature's own
  // markup/classes still decide color and text.
  const SELECTOR = "[data-jf-toast]";
  const AUTO_DISMISS_MS = 7000;
  const FADE_MS = 200;
  // Deliberately high-contrast, solid fills rather than a subtle tinted
  // border — a warning that blends into the page defeats the point of
  // pulling it out into a floating popup in the first place.
  const TONES: Record<string, { background: string; color: string; icon: string }> = {
    error: { background: "#dc2626", color: "#ffffff", icon: "⚠" },
    success: { background: "#16a34a", color: "#ffffff", icon: "✓" },
  };
  const DEFAULT_TONE = { background: "#1f2937", color: "#ffffff", icon: "" };

  function reduceMotion(): boolean {
    try {
      return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (err) {
      return false;
    }
  }

  function dismiss(el: HTMLElement | null): void {
    if (!el || el.getAttribute("data-jf-toast-dismissing")) return;
    el.setAttribute("data-jf-toast-dismissing", "true");
    if (reduceMotion()) {
      el.remove();
      return;
    }
    el.style.opacity = "0";
    el.style.transform = "translateY(-0.5rem)";
    setTimeout(() => {
      el.remove();
    }, FADE_MS);
  }

  function makeCloseButton(el: HTMLElement): void {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", "Dismiss");
    btn.textContent = "×"; // ×
    btn.style.cssText =
      "position:absolute;top:0.25rem;right:0.4rem;border:0;background:transparent;" +
      "font-size:1.25rem;line-height:1;cursor:pointer;color:inherit;opacity:0.8;padding:0.2rem;";
    btn.addEventListener("mouseenter", () => {
      btn.style.opacity = "1";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.opacity = "0.8";
    });
    btn.addEventListener("click", () => {
      dismiss(el);
    });
    el.appendChild(btn);
  }

  function applyTone(el: HTMLElement): void {
    const key = el.getAttribute("data-jf-toast") || "";
    const tone = TONES[key] || DEFAULT_TONE;
    el.style.background = tone.background;
    el.style.color = tone.color;
    el.style.border = "none";
    el.style.fontWeight = "600";
    if (tone.icon) {
      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = tone.icon + " ";
      el.insertBefore(icon, el.firstChild);
    }
  }

  function toastify(el: HTMLElement): void {
    if (el.getAttribute("data-jf-toast-ready")) return;
    el.setAttribute("data-jf-toast-ready", "true");

    applyTone(el);

    el.style.position = "fixed";
    el.style.top = "1rem";
    el.style.right = "1rem";
    el.style.left = "1rem";
    el.style.maxWidth = "28rem";
    el.style.marginLeft = "auto";
    el.style.zIndex = "2147483000";
    el.style.boxShadow = "0 6px 20px rgba(0, 0, 0, 0.3)";
    el.style.paddingRight = "2rem";

    if (!reduceMotion()) {
      el.style.transition = "opacity " + FADE_MS + "ms ease, transform " + FADE_MS + "ms ease";
      el.style.opacity = "0";
      el.style.transform = "translateY(-0.5rem)";
      // Next frame, so the transition actually runs instead of starting pre-applied.
      requestAnimationFrame(() => {
        el.style.opacity = "1";
        el.style.transform = "translateY(0)";
      });
    }

    makeCloseButton(el);
    setTimeout(() => {
      dismiss(el);
    }, AUTO_DISMISS_MS);
  }

  function init(): void {
    document.querySelectorAll<HTMLElement>(SELECTOR).forEach(toastify);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
