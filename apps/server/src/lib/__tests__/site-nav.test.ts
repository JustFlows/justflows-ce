// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fs.readFileSync(
  path.resolve(fileURLToPath(import.meta.url), "../../../../../../public/js/site-nav.js"),
  "utf8",
);

const HORIZONTAL_DROPDOWN = `
  <nav class="site-nav">
    <ul id="primary-list" class="jf-nav jf-nav--horizontal" data-jf-nav data-jf-nav-layout="horizontal" data-jf-nav-activation="click" data-jf-nav-breakpoint="768">
      <li class="jf-nav__item jf-nav__item--has-children">
        <span class="jf-nav__row">
          <a class="jf-nav__link" href="/about">About</a>
          <button type="button" class="jf-nav__trigger" aria-expanded="false" aria-haspopup="true" aria-controls="primary-submenu-0-0">
            <span class="jf-nav__chevron" aria-hidden="true">v</span>
          </button>
        </span>
        <ul id="primary-submenu-0-0" class="jf-nav__submenu jf-nav__submenu--start" hidden>
          <li class="jf-nav__item"><span class="jf-nav__row"><a class="jf-nav__link" href="/about/team">Team</a></span></li>
          <li class="jf-nav__item"><span class="jf-nav__row"><a class="jf-nav__link" href="/about/history">History</a></span></li>
        </ul>
      </li>
      <li class="jf-nav__item"><span class="jf-nav__row"><a class="jf-nav__link" href="/contact">Contact</a></span></li>
    </ul>
  </nav>`;

const WITH_HAMBURGER = `
  <nav class="site-nav">
    <button type="button" id="primary-toggle" class="jf-nav__toggle" aria-expanded="false" aria-controls="primary-list">Menu</button>
    <ul id="primary-list" class="jf-nav jf-nav--horizontal" data-jf-nav data-jf-nav-layout="horizontal" data-jf-nav-activation="click" data-jf-nav-breakpoint="768">
      <li class="jf-nav__item"><span class="jf-nav__row"><a class="jf-nav__link" href="/">Home</a></span></li>
    </ul>
  </nav>`;

const WITH_DRAWER = `
  <header class="site-header">
    <nav class="site-nav">
      <button type="button" id="primary-toggle" class="jf-nav__toggle" aria-expanded="false" aria-controls="primary-list">Menu</button>
      <button type="button" id="primary-backdrop" class="jf-nav__backdrop" tabindex="-1" hidden></button>
      <ul id="primary-list" class="jf-nav jf-nav--horizontal" data-jf-nav data-jf-nav-layout="horizontal" data-jf-nav-activation="click" data-jf-nav-breakpoint="768" data-jf-nav-mobile="drawer-right" data-jf-nav-motion="none" data-jf-nav-motion-ms="0" style="--jf-nav-motion-ms:0ms">
        <li class="jf-nav__panelhead" role="presentation"><button type="button" class="jf-nav__close" data-jf-nav-close aria-label="Close menu">✕</button></li>
        <li class="jf-nav__item"><span class="jf-nav__row"><a class="jf-nav__link" href="/">Home</a></span></li>
      </ul>
    </nav>
  </header>`;

function load(markup: string, viewportWidth = 1024): void {
  (window as unknown as { innerWidth: number }).innerWidth = viewportWidth;
  document.body.innerHTML = markup;
  new Function(script).call(window);
}

function trigger(): HTMLElement {
  return document.querySelector(".jf-nav__trigger")!;
}

function submenu(): HTMLElement {
  return document.getElementById("primary-submenu-0-0")!;
}

describe("site-nav dropdown", () => {
  it("opens a closed submenu on trigger click and sets aria-expanded", () => {
    load(HORIZONTAL_DROPDOWN);
    trigger().click();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(submenu().hasAttribute("hidden")).toBe(false);
  });

  it("closes an open submenu on a second trigger click", () => {
    load(HORIZONTAL_DROPDOWN);
    trigger().click();
    trigger().click();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(submenu().hasAttribute("hidden")).toBe(true);
  });

  it("closes the open submenu on Escape and returns focus to its trigger", () => {
    load(HORIZONTAL_DROPDOWN);
    trigger().click();
    const link = document.querySelector<HTMLElement>(".jf-nav__submenu .jf-nav__link")!;
    link.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger());
  });

  it("closes every open menu on a click outside the nav", () => {
    load(HORIZONTAL_DROPDOWN);
    trigger().click();
    document.body.click();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("moves focus between top-level controls with the arrow keys", () => {
    load(HORIZONTAL_DROPDOWN);
    const controls = document.querySelectorAll<HTMLElement>(
      "#primary-list > .jf-nav__item > .jf-nav__row > .jf-nav__link, #primary-list > .jf-nav__item > .jf-nav__row > .jf-nav__trigger",
    );
    controls[0]!.focus();
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(controls[1]);
  });

  it("moves focus between submenu items with the vertical arrow keys", () => {
    load(HORIZONTAL_DROPDOWN);
    trigger().click();
    const items = document.querySelectorAll<HTMLElement>("#primary-submenu-0-0 .jf-nav__link");
    items[0]!.focus();
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(items[1]);
  });
});

describe("site-nav mobile toggle", () => {
  it("does nothing on the toggle above the breakpoint (not in mobile mode)", () => {
    load(WITH_HAMBURGER, 1200);
    const btn = document.getElementById("primary-toggle")!;
    const list = document.getElementById("primary-list")!;
    expect(list.classList.contains("jf-nav--mobile")).toBe(false);
    btn.click();
    expect(list.classList.contains("jf-nav--open")).toBe(false);
  });

  it("opens a drawer below the breakpoint: mobile flag, backdrop, scroll-lock, portal to body", () => {
    load(WITH_DRAWER, 480);
    const btn = document.getElementById("primary-toggle")!;
    const list = document.getElementById("primary-list")!;
    const backdrop = document.getElementById("primary-backdrop")!;
    expect(list.classList.contains("jf-nav--mobile")).toBe(true);
    btn.click();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(list.classList.contains("jf-nav--open")).toBe(true);
    expect(backdrop.hasAttribute("hidden")).toBe(false);
    expect(document.body.classList.contains("jf-nav-scroll-lock")).toBe(true);
    expect(list.parentElement).toBe(document.body);
    expect(backdrop.parentElement).toBe(document.body);
  });

  it("closes on the in-panel close button and restores the list to the nav", () => {
    load(WITH_DRAWER, 480);
    const btn = document.getElementById("primary-toggle")!;
    const list = document.getElementById("primary-list")!;
    const backdrop = document.getElementById("primary-backdrop")!;
    btn.click();
    document.querySelector<HTMLElement>(".jf-nav__close")!.click();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(list.classList.contains("jf-nav--open")).toBe(false);
    expect(backdrop.hasAttribute("hidden")).toBe(true);
    expect(document.body.classList.contains("jf-nav-scroll-lock")).toBe(false);
    expect(list.closest(".site-nav")).not.toBeNull();
  });

  it("closes when the backdrop is tapped", () => {
    load(WITH_DRAWER, 480);
    document.getElementById("primary-toggle")!.click();
    document.getElementById("primary-backdrop")!.click();
    expect(document.getElementById("primary-list")!.classList.contains("jf-nav--open")).toBe(false);
  });

  it("closes on a click anywhere outside the open panel", () => {
    load(WITH_DRAWER.replace('data-jf-nav-mobile="drawer-right"', 'data-jf-nav-mobile="dropdown"'), 480);
    document.getElementById("primary-toggle")!.click();
    expect(document.getElementById("primary-list")!.classList.contains("jf-nav--open")).toBe(true);
    document.body.click();
    expect(document.getElementById("primary-list")!.classList.contains("jf-nav--open")).toBe(false);
  });

  it("closes an open drawer on Escape", () => {
    load(WITH_DRAWER, 480);
    const btn = document.getElementById("primary-toggle")!;
    btn.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.classList.contains("jf-nav-scroll-lock")).toBe(false);
  });

  it("drops mobile mode and force-closes when the window grows past the breakpoint", () => {
    load(WITH_DRAWER, 480);
    const btn = document.getElementById("primary-toggle")!;
    const list = document.getElementById("primary-list")!;
    btn.click();
    expect(list.classList.contains("jf-nav--open")).toBe(true);
    (window as unknown as { innerWidth: number }).innerWidth = 1300;
    window.dispatchEvent(new Event("orientationchange"));
    expect(list.classList.contains("jf-nav--mobile")).toBe(false);
    expect(list.classList.contains("jf-nav--open")).toBe(false);
    expect(list.closest(".site-nav")).not.toBeNull();
    expect(document.body.classList.contains("jf-nav-scroll-lock")).toBe(false);
  });
});
