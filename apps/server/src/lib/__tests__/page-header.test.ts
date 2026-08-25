import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_HEADER,
  headerBrandFlags,
  headerFromContentFields,
  parsePageHeader,
  resolveHeaderMenuSlug,
  withPageHeader,
} from "../page-header.js";

describe("parsePageHeader", () => {
  it("returns defaults for missing or invalid input", () => {
    expect(parsePageHeader(undefined)).toEqual(DEFAULT_PAGE_HEADER);
    expect(parsePageHeader(null)).toEqual(DEFAULT_PAGE_HEADER);
    expect(parsePageHeader("nope")).toEqual(DEFAULT_PAGE_HEADER);
    expect(parsePageHeader([])).toEqual(DEFAULT_PAGE_HEADER);
  });

  it("accepts a complete override", () => {
    expect(
      parsePageHeader({
        visible: false,
        menuMode: "menu",
        menuSlug: "footer",
        showLogo: false,
        showTitle: true,
        layout: "split",
      sticky: false,
      background: "#112233",
      showLanguageSwitcher: false,
      showColorScheme: true,
      showColorSchemeSystem: true,
      showAuthLinks: true,
    }),
    ).toEqual({
      visible: false,
      menuMode: "menu",
      menuSlug: "footer",
      showLogo: false,
      showTitle: true,
      layout: "split",
      sticky: false,
      background: "#112233",
      showLanguageSwitcher: false,
      showColorScheme: true,
      showColorSchemeSystem: true,
      showAuthLinks: true,
      blocks: [],
    });
  });

  it("rejects unsafe menu slugs, layouts, and CSS", () => {
    const parsed = parsePageHeader({
      menuMode: "popup",
      menuSlug: "primary; } body { display:none",
      layout: "floating",
      background: "red; } html { color: red",
    });
    expect(parsed.menuMode).toBe("inherit");
    expect(parsed.menuSlug).toBe("");
    expect(parsed.layout).toBe("logo-left");
    expect(parsed.background).toBe("");
  });

  it("keeps dropped header blocks", () => {
    const parsed = parsePageHeader({
      blocks: [
        { id: "lang", type: "core.language-switcher", version: 1, props: { style: "codes" } },
      ],
    });
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0]).toMatchObject({ type: "core.language-switcher" });
  });
});

describe("header field helpers", () => {
  it("reads and writes the reserved content field", () => {
    const fields = withPageHeader({ seoTitle: "Hi" }, {
      ...DEFAULT_PAGE_HEADER,
      menuMode: "none",
      visible: false,
    });
    expect(fields.seoTitle).toBe("Hi");
    expect(headerFromContentFields(fields)).toMatchObject({
      menuMode: "none",
      visible: false,
    });
  });
});

describe("headerBrandFlags", () => {
  it("hides the site title when showTitle is false, even if the logo is also off", () => {
    const header = { ...DEFAULT_PAGE_HEADER, showLogo: false, showTitle: false };
    expect(headerBrandFlags(header, "")).toEqual({ showLogo: false, showTitle: false });
    expect(headerBrandFlags(header, "/uploads/logo.png")).toEqual({ showLogo: false, showTitle: false });
  });

  it("shows the logo only when enabled and a URL exists", () => {
    expect(headerBrandFlags(DEFAULT_PAGE_HEADER, "")).toEqual({ showLogo: false, showTitle: true });
    expect(headerBrandFlags(DEFAULT_PAGE_HEADER, "/logo.png")).toEqual({ showLogo: true, showTitle: true });
  });
});

describe("resolveHeaderMenuSlug", () => {
  it("inherits the site default, including primary when unset", () => {
    expect(resolveHeaderMenuSlug(DEFAULT_PAGE_HEADER, "docs")).toBe("docs");
    expect(resolveHeaderMenuSlug(DEFAULT_PAGE_HEADER, null)).toBe("primary");
  });

  it("uses a page menu or none", () => {
    expect(
      resolveHeaderMenuSlug({ ...DEFAULT_PAGE_HEADER, menuMode: "menu", menuSlug: "shop" }, "primary"),
    ).toBe("shop");
    expect(resolveHeaderMenuSlug({ ...DEFAULT_PAGE_HEADER, menuMode: "none" }, "primary")).toBeNull();
    expect(resolveHeaderMenuSlug({ ...DEFAULT_PAGE_HEADER, visible: false }, "primary")).toBeNull();
  });
});
