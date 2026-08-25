(function () {
  "use strict";

  var STORAGE_KEY = "jf-color-scheme";
  var PREFERENCES = { light: 1, dark: 1, system: 1 };
  var DARK_QUERY = "(prefers-color-scheme: dark)";

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
      btn.setAttribute("aria-pressed", btn.getAttribute("data-jf-theme") === pressed ? "true" : "false");
    }
  }

  applyPreference(storedPreference());

  // Track the OS while the visitor has not chosen for themselves.
  try {
    if (window.matchMedia) {
      var query = window.matchMedia(DARK_QUERY);
      var onSystemChange = function () {
        if (storedPreference() === "system") applyPreference("system");
      };
      if (query.addEventListener) query.addEventListener("change", onSystemChange);
      else if (query.addListener) query.addListener(onSystemChange);
    }
  } catch (err) {
    /* matchMedia unavailable */
  }

  function onReady() {
    document.addEventListener("click", function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var btn = target.closest("[data-jf-theme]");
      if (!btn) return;
      var preference = btn.getAttribute("data-jf-theme");
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
