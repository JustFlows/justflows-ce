import { describe, expect, it } from "vitest";
import { createBlockRegistrySync } from "../index.js";

const registry = createBlockRegistrySync();

describe("site widget blocks", () => {
  it("registers color scheme, language switcher, and auth links", () => {
    expect(registry.get("core.color-scheme")?.title).toBe("Light / dark");
    expect(registry.get("core.language-switcher")?.title).toBe("Language switcher");
    expect(registry.get("core.auth-links")?.title).toBe("Login / Register");
  });

  it("renders a working color-scheme toggle without server context", () => {
    const html = registry.renderNode({
      type: "core.color-scheme",
      props: { style: "icons", align: "center" },
    });
    expect(html).toContain('data-jf-widget="color-scheme"');
    expect(html).toContain('data-jf-theme="light"');
    expect(html).toContain('data-jf-theme="dark"');
    expect(html).toContain("jf-site-widget--center");
    expect(html).not.toContain('data-jf-theme="system"');
  });

  it("adds the Auto button only when showSystem is on", () => {
    const html = registry.renderNode({
      type: "core.color-scheme",
      props: { showSystem: true },
    });
    expect(html).toContain('data-jf-theme="system"');
    expect(html).toContain("Auto");
  });

  it("ignores a non-boolean showSystem rather than rendering the button", () => {
    const html = registry.renderNode({
      type: "core.color-scheme",
      props: { showSystem: "yes" },
    });
    expect(html).not.toContain('data-jf-theme="system"');
  });

  it("renders language and auth placeholders for public hydration", () => {
    const language = registry.renderNode({
      type: "core.language-switcher",
      props: { style: "flag-country" },
    });
    expect(language).toContain("<!--jf:language-switcher-->");
    expect(language).toContain('data-jf-style="flag-country"');

    const auth = registry.renderNode({
      type: "core.auth-links",
      props: { showLogin: true, showRegister: false, loginLabel: "Sign in" },
    });
    expect(auth).toContain("<!--jf:auth-links-->");
    expect(auth).toContain('data-jf-show-register="0"');
    expect(auth).toContain("Sign in");
  });
});
