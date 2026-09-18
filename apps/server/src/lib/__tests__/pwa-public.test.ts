// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { buildPwaBodyHtml, buildPwaHeadHtml } from "../pwa-public.js";
import { DEFAULT_PWA_SETTINGS, type PwaSettings } from "../pwa-settings.js";

const enabled: PwaSettings = { ...DEFAULT_PWA_SETTINGS, enabled: true };

describe("buildPwaHeadHtml", () => {
  it("is empty when PWA is disabled", () => {
    expect(buildPwaHeadHtml(DEFAULT_PWA_SETTINGS)).toBe("");
  });

  it("emits the manifest link and theme-color meta when enabled", () => {
    const html = buildPwaHeadHtml(enabled);
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(html).toContain(`content="${enabled.themeColor}"`);
  });
});

describe("buildPwaBodyHtml", () => {
  it("is empty when PWA is disabled", () => {
    expect(buildPwaBodyHtml(DEFAULT_PWA_SETTINGS)).toBe("");
  });

  it("registers the service worker as an external script but skips the install script when installUi is disabled", () => {
    const settings = { ...enabled, installUi: { ...enabled.installUi, enabled: false } };
    const html = buildPwaBodyHtml(settings);
    expect(html).toContain('<script src="/js/pwa-register.js" defer></script>');
    expect(html).not.toContain("pwa-install.js");
  });

  it("never emits an inline <script> block — the default CSP (script-src 'self', no unsafe-inline) silently drops those", () => {
    const settings = {
      ...enabled,
      installUi: { enabled: true, label: "Get the app", description: "Fast and offline-ready", showLogo: false },
    };
    const html = buildPwaBodyHtml(settings);
    // Every <script> tag must carry a src attribute; none may be a bare
    // inline block (this is exactly what broke the install prompt under the
    // real CSP — curl showed correct HTML but Chrome silently dropped it).
    const scriptTags = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scriptTags.length).toBeGreaterThan(0);
    for (const tag of scriptTags) expect(tag).toMatch(/\bsrc="/);
  });

  it("passes the install label, description, and showLogo flag as data attributes on the script tag", () => {
    const settings = {
      ...enabled,
      installUi: { enabled: true, label: "Get the app", description: "Fast and offline-ready", showLogo: false },
    };
    const html = buildPwaBodyHtml(settings);
    expect(html).toContain('<script src="/js/pwa-install.js" defer');
    expect(html).toContain('data-label="Get the app"');
    expect(html).toContain('data-description="Fast and offline-ready"');
    expect(html).toContain('data-show-logo="0"');
  });

  it("HTML-attribute-escapes a label containing a double quote so it cannot close the attribute early", () => {
    const settings = {
      ...enabled,
      installUi: { enabled: true, label: '"><script>alert(1)</script>', description: "", showLogo: true },
    };
    const html = buildPwaBodyHtml(settings);
    // The raw payload must never appear verbatim inside the attribute value —
    // the escaped quote is what actually matters (it's what prevents the
    // value from terminating the attribute and injecting a new one/a tag).
    expect(html).not.toContain('data-label="">');
    expect(html).toContain("&quot;>&lt;script>alert(1)&lt;/script>");
  });
});
