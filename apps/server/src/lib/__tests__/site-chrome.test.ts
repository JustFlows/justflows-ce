// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

const script = fs.readFileSync(
  path.resolve(fileURLToPath(import.meta.url), "../../../../../../public/js/site-chrome.js"),
  "utf8",
);

const TOGGLE = `
  <div data-jf-widget="color-scheme">
    <button data-jf-theme="light" aria-pressed="false">Light</button>
    <button data-jf-theme="dark" aria-pressed="false">Dark</button>
  </div>`;

const TOGGLE_WITH_AUTO = `
  <div data-jf-widget="color-scheme">
    <button data-jf-theme="light" aria-pressed="false">Light</button>
    <button data-jf-theme="dark" aria-pressed="false">Dark</button>
    <button data-jf-theme="system" aria-pressed="false">Auto</button>
  </div>`;

const SINGLE_TOGGLE = `
  <div data-jf-widget="color-scheme">
    <button class="jf-color-scheme__toggle" data-jf-theme="toggle" aria-pressed="false">Dark mode</button>
  </div>`;

const SWITCH = `
  <div data-jf-widget="color-scheme">
    <button class="jf-color-scheme__switch" data-jf-theme="toggle" role="switch" aria-checked="false">
      <span class="jf-color-scheme__label">Dark mode</span>
      <span class="jf-color-scheme__track"><span class="jf-color-scheme__thumb"></span></span>
    </button>
  </div>`;

const SELECT = `
  <div data-jf-widget="color-scheme">
    <select data-jf-color-scheme-select>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </div>`;

let systemPrefersDark = false;
let notifySystemChange: () => void = () => {};

/** jsdom here runs without a storage area, so the script gets a minimal one. */
function installStorage(): Storage {
  const entries = new Map<string, string>();
  const storage = {
    get length() {
      return entries.size;
    },
    key: (i: number) => [...entries.keys()][i] ?? null,
    getItem: (k: string) => entries.get(k) ?? null,
    setItem: (k: string, v: string) => void entries.set(k, String(v)),
    removeItem: (k: string) => void entries.delete(k),
    clear: () => entries.clear(),
  } as Storage;
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
  return storage;
}

let storage: Storage;

/** Boot the site chrome the way the layout does: markup first, then the script. */
function load(markup = TOGGLE): void {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-preference");
  document.body.innerHTML = markup;

  const listeners: Array<() => void> = [];
  notifySystemChange = () => listeners.forEach((fn) => fn());
  window.matchMedia = ((query: string) => ({
    matches: query.includes("dark") && systemPrefersDark,
    media: query,
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
    removeEventListener: () => {},
    addListener: (fn: () => void) => listeners.push(fn),
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  new Function(script).call(window);
}

function pressed(): string[] {
  return [...document.querySelectorAll('[data-jf-theme][aria-pressed="true"]')].map(
    (el) => el.getAttribute("data-jf-theme") ?? "",
  );
}

function click(mode: string): void {
  document.querySelector<HTMLElement>(`[data-jf-theme="${mode}"]`)?.click();
}

describe("site-chrome color scheme", () => {
  beforeEach(() => {
    storage = installStorage();
    systemPrefersDark = false;
  });

  it("follows the operating system when the visitor has not chosen", () => {
    systemPrefersDark = true;
    load();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme-preference")).toBe("system");
  });

  it("honours an explicit choice over the operating system", () => {
    systemPrefersDark = true;
    storage.setItem("jf-color-scheme", "light");
    load();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(pressed()).toEqual(["light"]);
  });

  it("stores the choice when a button is clicked", () => {
    load();
    click("dark");
    expect(storage.getItem("jf-color-scheme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(pressed()).toEqual(["dark"]);
  });

  it("clears the stored choice when Auto is clicked", () => {
    systemPrefersDark = true;
    storage.setItem("jf-color-scheme", "light");
    load(TOGGLE_WITH_AUTO);
    click("system");
    expect(storage.getItem("jf-color-scheme")).toBe(null);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(pressed()).toEqual(["system"]);
  });

  it("tracks the operating system live while no choice is stored", () => {
    load(TOGGLE_WITH_AUTO);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    systemPrefersDark = true;
    notifySystemChange();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("leaves an explicit choice alone when the operating system changes", () => {
    load();
    click("light");
    systemPrefersDark = true;
    notifySystemChange();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("marks the resolved theme when the widget offers no Auto button", () => {
    systemPrefersDark = true;
    load();
    expect(pressed()).toEqual(["dark"]);
  });

  it("marks the preference, not the theme, when Auto is available", () => {
    systemPrefersDark = true;
    load(TOGGLE_WITH_AUTO);
    expect(pressed()).toEqual(["system"]);
  });

  it("ignores a stored value that is not a preference", () => {
    storage.setItem("jf-color-scheme", "solarized");
    load();
    expect(document.documentElement.getAttribute("data-theme-preference")).toBe("system");
  });

  it("flips light and dark from a single toggle and stores the choice", () => {
    load(SINGLE_TOGGLE);
    click("toggle");
    expect(storage.getItem("jf-color-scheme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    click("toggle");
    expect(storage.getItem("jf-color-scheme")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("reflects the resolved theme on the single toggle", () => {
    systemPrefersDark = true;
    load(SINGLE_TOGGLE);
    const btn = document.querySelector('[data-jf-theme="toggle"]');
    expect(btn?.getAttribute("aria-pressed")).toBe("true");
    expect(btn?.getAttribute("data-jf-resolved")).toBe("dark");
  });

  it("uses switch semantics for the switch design", () => {
    load(SWITCH);
    const sw = document.querySelector('[data-jf-theme="toggle"]');
    expect(sw?.getAttribute("aria-checked")).toBe("false");
    click("toggle");
    expect(sw?.getAttribute("aria-checked")).toBe("true");
    expect(storage.getItem("jf-color-scheme")).toBe("dark");
  });

  it("applies and stores the choice from the compact select", () => {
    load(SELECT);
    const select = document.querySelector<HTMLSelectElement>("[data-jf-color-scheme-select]")!;
    select.value = "dark";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(storage.getItem("jf-color-scheme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("keeps the compact select in step with the stored choice", () => {
    storage.setItem("jf-color-scheme", "dark");
    load(SELECT);
    const select = document.querySelector<HTMLSelectElement>("[data-jf-color-scheme-select]")!;
    expect(select.value).toBe("dark");
  });

  it("rejects external language destinations", () => {
    load('<select data-jf-language-select><option value="https://evil.example/" selected>Evil</option></select>');
    const before = window.location.href;
    document.querySelector("select")?.dispatchEvent(new Event("change", { bubbles: true }));
    expect(window.location.href).toBe(before);
  });
});
