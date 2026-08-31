import { describe, expect, it } from "vitest";
import { createBlockRegistrySync } from "@justflows/blocks";
import { hydrateSiteWidgets } from "../site-widgets.js";

const registry = createBlockRegistrySync();

const ctx = {
  languageLinks: [
    { code: "en-US", name: "English", href: "/about", current: true, displayCode: "EN-US" },
    { code: "nl-NL", name: "Nederlands", href: "/nl-NL/about", current: false, displayCode: "NL-NL" },
  ],
  usersCanRegister: true,
  labels: { login: "Log in", register: "Register", language: "Language" },
};

describe("hydrateSiteWidgets", () => {
  it("fills language links from the active locale list", () => {
    const html = registry.renderNode({ type: "core.language-switcher", props: { style: "names" } });
    const out = hydrateSiteWidgets(html, ctx);
    expect(out).toContain("/nl-NL/about");
    expect(out).toContain("Nederlands");
    expect(out).toContain("<details");
    expect(out).toContain("<summary");
    expect(out).toContain('aria-current="page"');
    expect(out).not.toContain("<!--jf:language-switcher-->");
  });

  it.each([
    ["locale-full", "nl-NL"],
    ["locale-short", ">nl<"],
    ["flags", "🇳🇱"],
    ["flag-locale", "🇳🇱 nl"],
    ["flag-country", "🇳🇱 Nederland"],
  ])("renders the %s language style", (style, label) => {
    const html = registry.renderNode({ type: "core.language-switcher", props: { style } });
    const out = hydrateSiteWidgets(html, ctx);
    expect(out).toContain(label);
    expect(out).toContain('hreflang="nl-NL"');
    if (style === "flags") expect(out).toContain('aria-label="Nederlands"');
  });

  it("hides the language switcher when only one locale is active", () => {
    const html = registry.renderNode({ type: "core.language-switcher", props: {} });
    const out = hydrateSiteWidgets(html, {
      ...ctx,
      languageLinks: [{ code: "en-US", name: "English", href: "/", current: true, displayCode: "EN-US" }],
    });
    expect(out).toBe("");
  });

  it("omits Register when anyone-can-register is off", () => {
    const html = registry.renderNode({
      type: "core.auth-links",
      props: { showLogin: true, showRegister: true },
    });
    const off = hydrateSiteWidgets(html, { ...ctx, usersCanRegister: false });
    expect(off).toContain("/login");
    expect(off).not.toContain("/register");

    const on = hydrateSiteWidgets(html, ctx);
    expect(on).toContain("/register");
  });

  it("leaves malformed and lookalike placeholders untouched", () => {
    const malformed = '<nav data-jf-widget="language-switcher"' + "=".repeat(20_000) + "<!--jf:language-switcher--></nav>";
    expect(hydrateSiteWidgets(malformed, ctx)).toBe(malformed);
    const lookalike = '<nav data-jf-widget="other"><!--jf:language-switcher--></nav>';
    expect(hydrateSiteWidgets(lookalike, ctx)).toBe(lookalike);
  });
});
