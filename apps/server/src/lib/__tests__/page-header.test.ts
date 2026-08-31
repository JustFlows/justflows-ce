import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_HEADER,
  headerBrandFlags,
  headerFromContentFields,
  headerRefFromContentFields,
  mergePageHeader,
  parsePageHeader,
  parsePageHeaderPatch,
  resolveHeaderMenuSlug,
  SITE_DEFAULT_HEADER_REF,
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
      languageSwitcherStyle: "flag-country",
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
      languageSwitcherStyle: "flag-country",
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
      languageSwitcherStyle: "custom-html",
    });
    expect(parsed.menuMode).toBe("inherit");
    expect(parsed.menuSlug).toBe("");
    expect(parsed.layout).toBe("logo-left");
    expect(parsed.background).toBe("");
    expect(parsed.languageSwitcherStyle).toBe("locale-short");
  });

  it("keeps dropped header blocks", () => {
    const parsed = parsePageHeader({
      blocks: [
        { id: "lang", type: "core.language-switcher", version: 1, props: { style: "flags" } },
      ],
    });
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0]).toMatchObject({ type: "core.language-switcher", props: { style: "flags" } });
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

describe("parsePageHeaderPatch", () => {
  it("keeps only the keys actually present", () => {
    expect(parsePageHeaderPatch({ sticky: false })).toEqual({ sticky: false });
    expect(parsePageHeaderPatch({})).toEqual({});
    expect(parsePageHeaderPatch(null)).toEqual({});
  });

  it("re-validates each present key", () => {
    const patch = parsePageHeaderPatch({
      layout: "floating",
      background: "red; } html{}",
      blocks: Array.from({ length: 60 }, () => ({ type: "core.paragraph" })),
    });
    expect(patch.layout).toBe("logo-left");
    expect(patch.background).toBe("");
    expect(patch.blocks).toHaveLength(40);
  });
});

describe("mergePageHeader", () => {
  it("overlays a patch, replacing blocks wholesale", () => {
    const base = { ...DEFAULT_PAGE_HEADER, sticky: true, blocks: [{ type: "a" }] } as never;
    const merged = mergePageHeader(base, { sticky: false });
    expect(merged.sticky).toBe(false);
    expect(merged.blocks).toEqual([{ type: "a" }]);
    expect(mergePageHeader(base, { blocks: [] } as never).blocks).toEqual([]);
  });

  it("clones blocks so callers cannot mutate the source", () => {
    const base = { ...DEFAULT_PAGE_HEADER, blocks: [] };
    expect(mergePageHeader(base, undefined).blocks).not.toBe(base.blocks);
  });
});

describe("headerRefFromContentFields", () => {
  it("returns the stored ref, or the site default when unset", () => {
    expect(headerRefFromContentFields({ jfHeaderRef: "abc" })).toBe("abc");
    expect(headerRefFromContentFields({ jfHeaderRef: "  " })).toBe(SITE_DEFAULT_HEADER_REF);
    expect(headerRefFromContentFields(undefined)).toBe(SITE_DEFAULT_HEADER_REF);
  });
});
