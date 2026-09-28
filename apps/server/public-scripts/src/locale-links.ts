// SPDX-License-Identifier: MIT

(function () {
  "use strict";

  // Client half of the host's link localization. The server already prefixes
  // links in rendered HTML; this catches links a script builds later (a cart
  // drawer, a product grid loaded by fetch) so a `/nl-NL` visitor who clicks
  // "Checkout" stays in Dutch without the plugin knowing about locales.
  // Only loaded on pages rendered in a non-default locale.
  interface Config {
    locale: string;
    locales: string[];
    skip: string[];
  }

  const node = document.getElementById("jf-locale-links");
  if (!node) return;
  let config: Config;
  try {
    config = JSON.parse(node.textContent || "{}") as Config;
  } catch {
    return;
  }
  if (!config.locale || !Array.isArray(config.locales) || !Array.isArray(config.skip)) return;

  const locales = new Set(config.locales.map((code) => code.toLowerCase()));
  const skip = new Set(config.skip);
  const prefix = `/${config.locale}`;

  function localize(href: string): string | null {
    if (href.charAt(0) !== "/" || href.charAt(1) === "/") return null;
    const cut = href.search(/[?#]/);
    const pathname = cut === -1 ? href : href.slice(0, cut);
    const suffix = cut === -1 ? "" : href.slice(cut);
    const segments = pathname.split("/").filter(Boolean);
    const first = segments[0];
    const last = segments[segments.length - 1] || "";
    if (first && (locales.has(first.toLowerCase()) || skip.has(first))) return null;
    if (last.indexOf(".") !== -1) return null;
    return (pathname === "/" ? prefix : prefix + pathname) + suffix;
  }

  function fix(anchor: Element): void {
    if (anchor.tagName !== "A" || anchor.hasAttribute("hreflang")) return;
    const href = anchor.getAttribute("href");
    if (!href) return;
    const next = localize(href.trim());
    if (next && next !== href) anchor.setAttribute("href", next);
  }

  function scan(root: ParentNode): void {
    root.querySelectorAll("a[href]").forEach(fix);
  }

  scan(document);
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        fix(record.target as Element);
        continue;
      }
      record.addedNodes.forEach((added) => {
        if (added.nodeType !== 1) return;
        fix(added as Element);
        scan(added as Element);
      });
    }
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["href"],
  });
})();
