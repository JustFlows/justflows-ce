import { describe, expect, it } from "vitest";
import { createBlockRegistrySync } from "@justflows/blocks";
import { hydrateSiteWidgets } from "../site-widgets.js";

const registry = createBlockRegistrySync();

const ctx = {
  languageLinks: [
    { code: "en", name: "English", href: "/about", current: true },
    { code: "nl", name: "Nederlands", href: "/nl/about", current: false },
  ],
  usersCanRegister: true,
  labels: { login: "Log in", register: "Register", language: "Language" },
};

describe("hydrateSiteWidgets", () => {
  it("fills language links from the active locale list", () => {
    const html = registry.renderNode({ type: "core.language-switcher", props: { style: "names" } });
    const out = hydrateSiteWidgets(html, ctx);
    expect(out).toContain("/nl/about");
    expect(out).toContain("Nederlands");
    expect(out).toContain('aria-current="page"');
    expect(out).not.toContain("<!--jf:language-switcher-->");
  });

  it("hides the language switcher when only one locale is active", () => {
    const html = registry.renderNode({ type: "core.language-switcher", props: {} });
    const out = hydrateSiteWidgets(html, {
      ...ctx,
      languageLinks: [{ code: "en", name: "English", href: "/", current: true }],
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
});
