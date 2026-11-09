// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { markupMatches, rebaseCssUrls } from "../../../src/lib/rendering/block-assets.js";

describe("markupMatches", () => {
  it("finds ids, classes, class prefixes, and attributes in real markup", () => {
    const html = `<div id="jf-cart-page" class="jf-cart-page"><p class='lead jf-product-price__now x'>€</p><form data-jf-form="contact"></form></div>`;
    expect(markupMatches(html, "#jf-cart-page")).toBe(true);
    expect(markupMatches(html, ".jf-cart-page")).toBe(true);
    expect(markupMatches(html, ".lead")).toBe(true);
    expect(markupMatches(html, ".jf-product-*")).toBe(true);
    expect(markupMatches(html, "[data-jf-form]")).toBe(true);
  });

  it("ignores text, look-alike names, and other attributes' values", () => {
    const html = `<p title="#jf-cart-page .jf-shop" data-note="data-jf-form">Use data-jf-form on a page.</p><div class="not-jf-shop jf-shopper" id="jf-cart-page-2" data-jf-formx></div>`;
    expect(markupMatches(html, "#jf-cart-page")).toBe(false);
    expect(markupMatches(html, ".jf-shop")).toBe(false);
    expect(markupMatches(html, "[data-jf-form]")).toBe(false);
    expect(markupMatches(html, "div p")).toBe(false);
  });
});

describe("rebaseCssUrls", () => {
  it("points relative urls at the stylesheet's own folder and leaves the rest", () => {
    expect(rebaseCssUrls(`a{background:url(img/x.png)}b{src:url("fonts/f.woff2")}c{background:url(/abs.png)}d{background:url(data:image/png;base64,AA)}`, "/ext/acme.shop/css/")).toBe(
      `a{background:url(/ext/acme.shop/css/img/x.png)}b{src:url("/ext/acme.shop/css/fonts/f.woff2")}c{background:url(/abs.png)}d{background:url(data:image/png;base64,AA)}`,
    );
  });
});
