// SPDX-License-Identifier: MIT
import en from "../../src/lib/i18n/site-catalogs/en.json";

(function () {
  "use strict";

  // Registers the service worker and shows a small "update available" toast.
  // Kept as an external file (not an inline <script>) so it runs unmodified
  // under the default CSP, which is `script-src 'self'` with no
  // `'unsafe-inline'` — see docs/PWA.md and pwa-install.ts for the same
  // reasoning applied to the install-prompt banner.
  if (!("serviceWorker" in navigator)) return;
  const labels = (document.currentScript as HTMLScriptElement | null)?.dataset;

  function showUpdateToast(installingWorker: ServiceWorker): void {
    const toast = document.createElement("div");
    toast.setAttribute("role", "status");
    toast.style.cssText =
      "position:fixed;left:1rem;bottom:1rem;z-index:2147483647;background:#111;color:#fff;" +
      "padding:.75rem 1rem;border-radius:.5rem;font:14px/1.4 system-ui,sans-serif;" +
      "box-shadow:0 2px 12px rgba(0,0,0,.25);display:flex;gap:.75rem;align-items:center";

    const text = document.createElement("span");
    text.textContent = labels?.updateAvailable || en["pwa.updateAvailable"];
    toast.appendChild(text);

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = labels?.reload || en["pwa.reload"];
    button.style.cssText =
      "font:inherit;background:#fff;color:#111;border:0;border-radius:.3rem;padding:.35rem .75rem;cursor:pointer";
    button.addEventListener("click", () => {
      installingWorker.postMessage({ type: "SKIP_WAITING" });
    });
    toast.appendChild(button);

    document.body.appendChild(toast);
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              showUpdateToast(installing);
            }
          });
        });
      })
      .catch(() => {});

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      location.reload();
    });
  });
})();
