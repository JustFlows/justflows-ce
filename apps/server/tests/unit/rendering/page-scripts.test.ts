// SPDX-License-Identifier: MIT

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(path.join(tmpdir(), "jf-page-scripts-"));
vi.mock("../../../src/lib/runtime/jf-root.js", () => ({ getJfRoot: () => root }));

const {
  applyPageScripts,
  BODY_SCRIPTS_SLOT,
  HASHED_PUBLIC_SCRIPT,
  HEAD_SCRIPTS_SLOT,
  HEAD_STYLES_SLOT,
  pageScriptNames,
  publicScriptUrl,
  resetPublicScriptManifest,
} = await import("../../../src/lib/rendering/page-scripts.js");

const page = (body: string) =>
  `<html><head>${HEAD_STYLES_SLOT}<link rel="stylesheet" href="/theme.css">${HEAD_SCRIPTS_SLOT}</head><body>${body}${BODY_SCRIPTS_SLOT}</body></html>`;

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("pageScriptNames", () => {
  it("loads only the colour-scheme script on a page without interactive markup", () => {
    expect(pageScriptNames(page("<main><p>Hello</p></main>"))).toEqual(["site-chrome"]);
  });

  it("adds each script for the markup that needs it", () => {
    expect(pageScriptNames('<ul class="jf-nav" data-jf-nav>')).toContain("site-nav");
    expect(pageScriptNames('<p data-jf-toast="success">Saved</p>')).toContain("site-toast");
    expect(pageScriptNames('<a href="/nl/login">Sign in</a>')).toContain("site-session");
    expect(pageScriptNames('<div data-jf-anim="in-view">')).toContain("block-animations");
    expect(pageScriptNames('<div class="jf-tabs">')).toContain("block-interactions");
    expect(pageScriptNames('<div class="jf-accordion" data-jf-exclusive="true">')).toContain("block-interactions");
  });

  it("does not mistake look-alike markup for a need", () => {
    const names = pageScriptNames('<p data-jf-toast-ready="true"></p><a href="/blog/login-tips">x</a><div data-jf-anim="load">');
    expect(names).toEqual(["site-chrome"]);
  });
});

describe("applyPageScripts", () => {
  beforeEach(() => {
    rmSync(path.join(root, "public"), { recursive: true, force: true });
    resetPublicScriptManifest();
  });

  it("fills the slots: site-chrome blocking, everything else deferred, extras last", () => {
    const html = applyPageScripts(page('<nav data-jf-nav></nav><div data-jf-anim="in-view"></div>'), {
      head: ['<meta name="x">'],
      body: ['<script src="/theme.js?v=abc" defer></script>'],
    });
    expect(html).not.toContain(HEAD_SCRIPTS_SLOT);
    expect(html).not.toContain(BODY_SCRIPTS_SLOT);
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain('<script src="/js/site-chrome.js"></script>\n<script src="/js/site-nav.js" defer></script>\n<meta name="x">');
    const body = html.slice(html.indexOf("<body>"));
    expect(body).toContain('<script src="/js/block-animations.js" defer></script>\n<script src="/theme.js?v=abc" defer></script>');
    expect(html).not.toContain("block-interactions");
  });

  it("links the hashed URL from the build manifest", () => {
    mkdirSync(path.join(root, "public", "js"), { recursive: true });
    writeFileSync(
      path.join(root, "public", "js", "manifest.json"),
      JSON.stringify({ "site-chrome": "/js/site-chrome-ABCD2345.js", "site-nav": "/js/other-ABCD2345.js" }),
    );
    expect(publicScriptUrl("site-chrome")).toBe("/js/site-chrome-ABCD2345.js");
    /** An entry that does not name its own script is ignored. */
    expect(publicScriptUrl("site-nav")).toBe("/js/site-nav.js");
  });
});

describe("page stylesheets", () => {
  it("links the KaTeX stylesheet only on a page with a formula", () => {
    const math = applyPageScripts(page('<p>Area: <span class="jf-math" data-formula="\\pi r^2" contenteditable="false"><span class="katex">…</span></span></p>'));
    /** Before the theme stylesheet, so the theme can override it. */
    expect(math).toContain('<link rel="stylesheet" href="/vendor/katex/katex.min.css"><link rel="stylesheet" href="/theme.css">');
    expect(applyPageScripts(page("<p>No formulas here, not even jf-math as text.</p>"))).not.toContain("katex.min.css");
  });
});

describe("HASHED_PUBLIC_SCRIPT", () => {
  it("matches build output names and their maps only", () => {
    expect(HASHED_PUBLIC_SCRIPT.exec("/js/site-nav-LQ4PGNP5.js")?.[1]).toBe("site-nav");
    expect(HASHED_PUBLIC_SCRIPT.test("/js/site-nav-LQ4PGNP5.js.map")).toBe(true);
    expect(HASHED_PUBLIC_SCRIPT.test("/js/site-nav.js")).toBe(false);
    expect(HASHED_PUBLIC_SCRIPT.test("/js/../x-LQ4PGNP5.js")).toBe(false);
  });
});
