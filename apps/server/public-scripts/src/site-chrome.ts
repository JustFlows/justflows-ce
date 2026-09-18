type ColorPreference = "light" | "dark" | "system";

declare global {
  interface Window {
    __jfSiteChromeGeneration?: number;
  }
}

(function () {
  "use strict";

  const STORAGE_KEY = "jf-color-scheme";
  const PREFERENCES: Record<string, 1> = { light: 1, dark: 1, system: 1 };
  const DARK_QUERY = "(prefers-color-scheme: dark)";

  // Only the most recent run of this script owns the delegated listeners. If
  // it is evaluated twice (a stray second <script>, a test re-boot), the older
  // listeners fall dormant instead of both reacting to the same click — which
  // would cancel out a non-idempotent control like the single toggle.
  const generation = ((window.__jfSiteChromeGeneration || 0) + 1) | 0;
  window.__jfSiteChromeGeneration = generation;
  function current(): boolean {
    return window.__jfSiteChromeGeneration === generation;
  }

  /** The visitor's stored choice. No choice means follow the operating system. */
  function storedPreference(): ColorPreference {
    try {
      const value = localStorage.getItem(STORAGE_KEY) || "";
      return PREFERENCES[value] ? (value as ColorPreference) : "system";
    } catch (err) {
      return "system";
    }
  }

  function systemTheme(): "light" | "dark" {
    try {
      return window.matchMedia && window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
    } catch (err) {
      return "light";
    }
  }

  function resolveTheme(preference: ColorPreference): "light" | "dark" {
    return preference === "system" ? systemTheme() : preference;
  }

  /**
   * A widget that offers no "system" button cannot show the system preference,
   * so there it reads as the theme the visitor is actually looking at. With a
   * system button present, pressed means the preference itself.
   */
  function pressedMode(preference: ColorPreference, theme: "light" | "dark"): string {
    if (preference !== "system") return preference;
    return document.querySelector('[data-jf-theme="system"]') ? "system" : theme;
  }

  function applyPreference(preference: ColorPreference): void {
    if (!PREFERENCES[preference]) preference = "system";
    const theme = resolveTheme(preference);
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-theme-preference", preference);
    root.style.colorScheme = theme;

    const pressed = pressedMode(preference, theme);
    const buttons = document.querySelectorAll<HTMLElement>("[data-jf-theme]");
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i]!;
      const mode = btn.getAttribute("data-jf-theme");
      if (mode === "toggle") {
        // A single control: "on" means the visitor is looking at dark.
        const on = theme === "dark" ? "true" : "false";
        if (btn.getAttribute("role") === "switch") btn.setAttribute("aria-checked", on);
        else btn.setAttribute("aria-pressed", on);
        btn.setAttribute("data-jf-resolved", theme);
      } else {
        btn.setAttribute("aria-pressed", mode === pressed ? "true" : "false");
      }
    }

    const selects = document.querySelectorAll<HTMLSelectElement>("[data-jf-color-scheme-select]");
    for (let s = 0; s < selects.length; s++) {
      const select = selects[s]!;
      const want = preference;
      select.value = want;
      // No "system" option on this widget: fall back to the visible theme.
      if (select.value !== want) select.value = theme;
    }
  }

  applyPreference(storedPreference());

  // Track the OS while the visitor has not chosen for themselves.
  try {
    if (window.matchMedia) {
      const query = window.matchMedia(DARK_QUERY);
      const onSystemChange = (): void => {
        if (current() && storedPreference() === "system") applyPreference("system");
      };
      if (query.addEventListener) query.addEventListener("change", onSystemChange);
      else if ("addListener" in query) (query as any).addListener(onSystemChange);
    }
  } catch (err) {
    /* matchMedia unavailable */
  }

  function onReady(): void {
    document.addEventListener("click", (event) => {
      if (!current()) return;
      const target = event.target as Element | null;
      if (!target || !target.closest) return;
      const btn = target.closest<HTMLElement>("[data-jf-theme]");
      if (!btn) return;
      let preference = btn.getAttribute("data-jf-theme") as ColorPreference | null;
      if (preference === ("toggle" as ColorPreference)) {
        // Flip to the opposite of whatever the visitor sees right now.
        preference = resolveTheme(storedPreference()) === "dark" ? "light" : "dark";
      }
      if (!preference || !PREFERENCES[preference]) return;
      try {
        if (preference === "system") localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, preference);
      } catch (err) {
        /* private mode */
      }
      applyPreference(preference);
    });

    document.addEventListener("change", (event) => {
      if (!current()) return;
      const picker = event.target as HTMLElement | null;
      if (picker && picker.getAttribute && picker.getAttribute("data-jf-color-scheme-select") != null) {
        const choice = (picker as HTMLSelectElement).value as ColorPreference;
        if (!PREFERENCES[choice]) return;
        try {
          if (choice === "system") localStorage.removeItem(STORAGE_KEY);
          else localStorage.setItem(STORAGE_KEY, choice);
        } catch (err) {
          /* private mode */
        }
        applyPreference(choice);
        return;
      }

      const select = event.target as HTMLSelectElement | null;
      if (!select || select.getAttribute("data-jf-language-select") == null) return;
      const option = select.options && select.options[select.selectedIndex];
      const href = option && option.getAttribute("value");
      if (!href || href.charAt(0) !== "/" || href.slice(0, 2) === "//") return;
      const targetUrl = new URL(href, window.location.origin);
      if (targetUrl.origin === window.location.origin) window.location.assign(targetUrl.href);
    });

    applyPreference(storedPreference());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady);
  } else {
    onReady();
  }
})();

export {};
