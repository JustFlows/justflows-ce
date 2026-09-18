interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

(function () {
  "use strict";

  // Captured synchronously at parse time — document.currentScript is only
  // valid during this script's own initial (even if deferred) execution,
  // never inside a later async/event-driven callback.
  const SCRIPT_TAG = document.currentScript as HTMLScriptElement | null;

  const DISMISS_KEY = "jf_pwa_install_dismissed";

  // The community-adopted "PWA logo" (white variant), CC0/free-to-use —
  // https://github.com/webmaxru/progressive-web-apps-logo. Inlined so the
  // banner needs no extra network request and can be toggled per site
  // (Settings → PWA → Install prompt → Show PWA logo).
  const PWA_LOGO_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1952 734.93" width="34" height="13" aria-hidden="true" focusable="false">' +
    '<path fill="#fff" d="M 1436.62,603.304L 1493.01,460.705L 1655.83,460.705L 1578.56,244.39L 1675.2,0.000528336L 1952,734.933L 1747.87,734.933L 1700.57,603.304L 1436.62,603.304 Z"/>' +
    '<path fill="#fff" d="M 1262.47,734.935L 1558.79,0.00156593L 1362.34,0.0025425L 1159.64,474.933L 1015.5,0.00351906L 864.499,0.00351906L 709.731,474.933L 600.585,258.517L 501.812,562.819L 602.096,734.935L 795.427,734.935L 935.284,309.025L 1068.63,734.935L 1262.47,734.935 Z"/>' +
    '<path fill="#fff" d="M 186.476,482.643L 307.479,482.643C 344.133,482.643 376.772,478.552 405.396,470.37L 436.689,373.962L 524.148,104.516C 517.484,93.9535 509.876,83.9667 501.324,74.5569C 456.419,24.852 390.719,0.000406265 304.222,0.000406265L -3.8147e-006,0.000406265L -3.8147e-006,734.933L 186.476,734.933L 186.476,482.643 Z M 346.642,169.079C 364.182,186.732 372.951,210.355 372.951,239.95C 372.951,269.772 365.238,293.424 349.813,310.906C 332.903,330.331 301.766,340.043 256.404,340.043L 186.476,340.043L 186.476,142.598L 256.918,142.598C 299.195,142.598 329.103,151.425 346.642,169.079 Z"/>' +
    "</svg>";

  interface InstallConfig {
    label: string;
    description: string;
    showLogo: boolean;
  }

  function config(): InstallConfig {
    const data = (SCRIPT_TAG && SCRIPT_TAG.dataset) || ({} as DOMStringMap);
    return {
      label: data.label || "Install",
      description: data.description || "Install this app for a faster, full-screen experience.",
      showLogo: data.showLogo !== "0",
    };
  }

  function isStandalone(): boolean {
    try {
      return Boolean(
        (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
          (navigator as Navigator & { standalone?: boolean }).standalone === true,
      );
    } catch (err) {
      return false;
    }
  }

  function isDismissed(): boolean {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch (err) {
      return false;
    }
  }

  function setDismissed(): void {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch (err) {
      // Storage unavailable — the banner simply reappears next visit.
    }
  }

  function isIos(): boolean {
    return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
  }

  function isSafari(): boolean {
    const ua = navigator.userAgent || "";
    return /safari/i.test(ua) && !/crios|fxios|edgios|chrome/i.test(ua);
  }

  function buildBanner(
    onInstall: (() => void) | null,
    message: string,
    buttonLabel: string,
    showLogo: boolean,
  ): HTMLDivElement {
    const banner = document.createElement("div");
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "Install this app");
    banner.style.cssText =
      "position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:2147483000;" +
      "max-width:26rem;margin:0 auto;background:#111;color:#fff;border-radius:.6rem;" +
      "padding:.9rem 1rem;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.3);" +
      "display:flex;gap:.75rem;align-items:center";

    if (showLogo) {
      const logo = document.createElement("span");
      logo.style.cssText = "flex:none;display:inline-flex;align-items:center";
      logo.innerHTML = PWA_LOGO_SVG;
      banner.appendChild(logo);
    }

    const text = document.createElement("span");
    text.style.flex = "1";
    text.textContent = message;
    banner.appendChild(text);

    if (onInstall) {
      const install = document.createElement("button");
      install.type = "button";
      install.textContent = buttonLabel;
      install.style.cssText =
        "font:inherit;background:#fff;color:#111;border:0;border-radius:.35rem;padding:.4rem .85rem;cursor:pointer";
      install.addEventListener("click", onInstall);
      banner.appendChild(install);
    }

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", "Dismiss");
    dismiss.textContent = "✕";
    dismiss.style.cssText =
      "font:inherit;background:transparent;color:#fff;border:0;padding:.4rem;cursor:pointer;opacity:.8";
    dismiss.addEventListener("click", () => {
      setDismissed();
      banner.remove();
    });
    banner.appendChild(dismiss);

    return banner;
  }

  function ready(fn: () => void): void {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  ready(() => {
    if (isStandalone() || isDismissed()) return;

    const cfg = config();
    let deferredPrompt: BeforeInstallPromptEvent | null = null;

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredPrompt = event as BeforeInstallPromptEvent;
      const banner = buildBanner(
        () => {
          banner.remove();
          deferredPrompt?.prompt();
          deferredPrompt = null;
        },
        cfg.description,
        cfg.label,
        cfg.showLogo,
      );
      document.body.appendChild(banner);
    });

    // Chromium fires beforeinstallprompt when installable; iOS Safari never
    // does, so this is the only way visitors there learn Add to Home Screen
    // exists. The Share-sheet steps are iOS-specific and not configurable —
    // only the logo follows the site's own choice.
    if (isIos() && isSafari()) {
      document.body.appendChild(
        buildBanner(null, "Install this app: tap Share, then “Add to Home Screen”.", "", cfg.showLogo),
      );
    }
  });
})();
