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

  it("falls back to the buttons style for an unknown design", () => {
    const html = registry.renderNode({
      type: "core.color-scheme",
      props: { style: "hologram" },
    });
    expect(html).toContain('data-jf-style="buttons"');
  });

  it("renders the single toggle as one control the preference engine drives", () => {
    const html = registry.renderNode({ type: "core.color-scheme", props: { style: "toggle" } });
    expect(html).toContain('data-jf-style="toggle"');
    expect(html).toContain('data-jf-theme="toggle"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('data-jf-theme="light"');
  });

  it("gives the switch design switch semantics", () => {
    const html = registry.renderNode({ type: "core.color-scheme", props: { style: "switch" } });
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
  });

  it("renders the compact design as a labelled select", () => {
    const html = registry.renderNode({
      type: "core.color-scheme",
      props: { style: "select", showSystem: true },
    });
    expect(html).toContain("data-jf-color-scheme-select");
    expect(html).toContain('<option value="light">Light</option>');
    expect(html).toContain('<option value="system">Auto</option>');
    expect(html).toContain('aria-label="Appearance"');
  });

  it("adds tooltips to the tooltip-icons design and hides labels via CSS", () => {
    const html = registry.renderNode({ type: "core.color-scheme", props: { style: "tooltip-icons" } });
    expect(html).toContain('title="Light"');
    expect(html).toContain('title="Dark"');
  });

  it("drops the animation hook when animate is off", () => {
    const on = registry.renderNode({ type: "core.color-scheme", props: {} });
    const off = registry.renderNode({ type: "core.color-scheme", props: { animate: false } });
    expect(on).toContain("is-animated");
    expect(off).not.toContain("is-animated");
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
