// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Email logos picked from the media library are site-relative; sent mail
 * needs full addresses (justflows-ce#317).
 */

const state = vi.hoisted(() => ({ primary: null as string | null, tablesMissing: false }));

vi.mock("../../../src/lib/database/db.js", () => ({
  getControlDb: async () => ({
    query: async () => {
      if (state.tablesMissing) throw new Error("relation \"site_domains\" does not exist");
      return state.primary ? [{ hostname: state.primary }] : [];
    },
  }),
}));

const { absoluteEmailAssetUrl, emailSiteOrigin, withAbsoluteLogos } = await import("../../../src/lib/email/email-asset-url.js");
const { DEFAULT_EMAIL_DESIGN, listEmailTemplateDefinitions, previewValues, renderEmailSource } = await import("../../../src/lib/email/email-templates.js");

const ORIGINAL_APP_URL = process.env.APP_URL;
beforeEach(() => {
  state.primary = null;
  state.tablesMissing = false;
  process.env.APP_URL = "https://install.example.com/";
});
afterEach(() => {
  if (ORIGINAL_APP_URL === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = ORIGINAL_APP_URL;
});

describe("logo addresses for sent mail", () => {
  it("turns a library address into a full address on the given origin", () => {
    expect(absoluteEmailAssetUrl("/uploads/2026/11/logo.png", "https://shop.example.com")).toBe("https://shop.example.com/uploads/2026/11/logo.png");
  });

  it("keeps external HTTPS addresses", () => {
    expect(absoluteEmailAssetUrl("https://cdn.example.net/brand/logo.png", "https://shop.example.com")).toBe("https://cdn.example.net/brand/logo.png");
  });

  it("refuses every other address", () => {
    for (const value of ["http://cdn.example.net/logo.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "//evil.example/logo.png", "/admin/logo.png", "/uploads/../.env", "logo.png"]) {
      expect(absoluteEmailAssetUrl(value, "https://shop.example.com")).toBe("");
    }
  });

  it("drops a library address when no origin is known", () => {
    expect(absoluteEmailAssetUrl("/uploads/logo.png", null)).toBe("");
  });

  it("converts both logos and leaves the rest of the design alone", () => {
    const design = withAbsoluteLogos({ ...DEFAULT_EMAIL_DESIGN, logoUrl: "/uploads/light.png", darkLogoUrl: "/uploads/dark.png" }, "https://shop.example.com");
    expect(design).toMatchObject({ logoUrl: "https://shop.example.com/uploads/light.png", darkLogoUrl: "https://shop.example.com/uploads/dark.png", accentColor: DEFAULT_EMAIL_DESIGN.accentColor });
  });
});

describe("the site origin for mail", () => {
  it("is the site's primary domain", async () => {
    state.primary = "Shop.Example.com";
    expect(await emailSiteOrigin("s1")).toBe("https://shop.example.com");
  });

  it("falls back to APP_URL without a primary domain or domain tables", async () => {
    expect(await emailSiteOrigin("s1")).toBe("https://install.example.com");
    state.tablesMissing = true;
    expect(await emailSiteOrigin("s1")).toBe("https://install.example.com");
  });
});

describe("the rendered email", () => {
  const definition = listEmailTemplateDefinitions().find((item) => item.key === "core.password-reset")!;
  const render = (logoUrl: string, darkLogoUrl = "") =>
    renderEmailSource({ key: definition.key, values: previewValues(definition), source: definition.defaults, design: { ...DEFAULT_EMAIL_DESIGN, logoUrl, darkLogoUrl } }).html;

  it("shows a full-address logo", () => {
    expect(render("https://shop.example.com/uploads/logo.png")).toContain('<img src="https://shop.example.com/uploads/logo.png"');
  });

  it("offers the dark logo to mail apps in dark mode", () => {
    const html = render("https://shop.example.com/uploads/light.png", "https://shop.example.com/uploads/dark,v2.png");
    expect(html).toContain('<picture><source srcset="https://shop.example.com/uploads/dark%2Cv2.png" media="(prefers-color-scheme: dark)"><img src="https://shop.example.com/uploads/light.png"');
  });

  it("shows no dark logo without a regular one", () => {
    expect(render("", "https://shop.example.com/uploads/dark.png")).not.toContain("<picture>");
  });
});
