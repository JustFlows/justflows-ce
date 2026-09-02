(function () {
  "use strict";

  var STORAGE_KEY = "jf-color-scheme";
  var PREFERENCES = { light: 1, dark: 1, system: 1 };
  var DARK_QUERY = "(prefers-color-scheme: dark)";

  // Only the most recent run of this script owns the delegated listeners. If
  // it is evaluated twice (a stray second <script>, a test re-boot), the older
  // listeners fall dormant instead of both reacting to the same click — which
  // would cancel out a non-idempotent control like the single toggle.
  var generation = ((window.__jfSiteChromeGeneration || 0) + 1) | 0;
  window.__jfSiteChromeGeneration = generation;
  function current() {
    return window.__jfSiteChromeGeneration === generation;
  }

  /** The visitor's stored choice. No choice means follow the operating system. */
  function storedPreference() {
    try {
      var value = localStorage.getItem(STORAGE_KEY);
      return PREFERENCES[value] ? value : "system";
    } catch (err) {
      return "system";
    }
  }

  function systemTheme() {
    try {
      return window.matchMedia && window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
    } catch (err) {
      return "light";
    }
  }

  function resolveTheme(preference) {
    return preference === "system" ? systemTheme() : preference;
  }

  /**
   * A widget that offers no "system" button cannot show the system preference,
   * so there it reads as the theme the visitor is actually looking at. With a
   * system button present, pressed means the preference itself.
   */
  function pressedMode(preference, theme) {
    if (preference !== "system") return preference;
    return document.querySelector('[data-jf-theme="system"]') ? "system" : theme;
  }

  function applyPreference(preference) {
    if (!PREFERENCES[preference]) preference = "system";
    var theme = resolveTheme(preference);
    var root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-theme-preference", preference);
    root.style.colorScheme = theme;

    var pressed = pressedMode(preference, theme);
    var buttons = document.querySelectorAll("[data-jf-theme]");
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var mode = btn.getAttribute("data-jf-theme");
      if (mode === "toggle") {
        // A single control: "on" means the visitor is looking at dark.
        var on = theme === "dark" ? "true" : "false";
        if (btn.getAttribute("role") === "switch") btn.setAttribute("aria-checked", on);
        else btn.setAttribute("aria-pressed", on);
        btn.setAttribute("data-jf-resolved", theme);
      } else {
        btn.setAttribute("aria-pressed", mode === pressed ? "true" : "false");
      }
    }

    var selects = document.querySelectorAll("[data-jf-color-scheme-select]");
    for (var s = 0; s < selects.length; s++) {
      var want = preference;
      selects[s].value = want;
      // No "system" option on this widget: fall back to the visible theme.
      if (selects[s].value !== want) selects[s].value = theme;
    }
  }

  applyPreference(storedPreference());

  // Track the OS while the visitor has not chosen for themselves.
  try {
    if (window.matchMedia) {
      var query = window.matchMedia(DARK_QUERY);
      var onSystemChange = function () {
        if (current() && storedPreference() === "system") applyPreference("system");
      };
      if (query.addEventListener) query.addEventListener("change", onSystemChange);
      else if (query.addListener) query.addListener(onSystemChange);
    }
  } catch (err) {
    /* matchMedia unavailable */
  }

  function onReady() {
    document.addEventListener("click", function (event) {
      if (!current()) return;
      var target = event.target;
      if (!target || !target.closest) return;
      var btn = target.closest("[data-jf-theme]");
      if (!btn) return;
      var preference = btn.getAttribute("data-jf-theme");
      if (preference === "toggle") {
        // Flip to the opposite of whatever the visitor sees right now.
        preference = resolveTheme(storedPreference()) === "dark" ? "light" : "dark";
      }
      if (!PREFERENCES[preference]) return;
      try {
        if (preference === "system") localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, preference);
      } catch (err) {
        /* private mode */
      }
      applyPreference(preference);
    });

    document.addEventListener("change", function (event) {
      if (!current()) return;
      var picker = event.target;
      if (picker && picker.getAttribute && picker.getAttribute("data-jf-color-scheme-select") != null) {
        var choice = picker.value;
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

      var select = event.target;
      if (!select || select.getAttribute("data-jf-language-select") == null) return;
      var option = select.options && select.options[select.selectedIndex];
      var href = option && option.getAttribute("value");
      if (!href || href.charAt(0) !== "/" || href.slice(0, 2) === "//") return;
      var targetUrl = new URL(href, window.location.origin);
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
