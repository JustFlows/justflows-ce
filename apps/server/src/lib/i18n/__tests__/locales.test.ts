import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTENT_LOCALE,
  INSTALL_LOCALE_CODES,
  displayLocaleCode,
  localePath,
  localizePublicPath,
  matchActiveLocale,
  normalizeLocale,
  parseLocalePrefix,
  pickLocaleFromHeader,
} from "../locales.js";

describe("DEFAULT_CONTENT_LOCALE", () => {
  it("is the regional English tag used for empty-site bootstrap", () => {
    expect(DEFAULT_CONTENT_LOCALE).toBe("en-US");
  });

  it("is offered in the install wizard language list", () => {
    expect(INSTALL_LOCALE_CODES).toContain(DEFAULT_CONTENT_LOCALE);
  });
});

describe("normalizeLocale", () => {
  it("canonicalizes BCP 47 casing without inventing a region", () => {
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("EN")).toBe("en");
    expect(normalizeLocale("nl-nl")).toBe("nl-NL");
    expect(normalizeLocale("en-us")).toBe("en-US");
    expect(normalizeLocale("zh-hant-tw")).toBe("zh-Hant-TW");
    expect(normalizeLocale("en-UK")).toBe("en-UK");
  });

  it("rejects invalid tags", () => {
    expect(normalizeLocale("")).toBeNull();
    expect(normalizeLocale("e")).toBeNull();
    expect(normalizeLocale("english")).toBeNull();
  });
});

describe("matchActiveLocale", () => {
  it("matches only the exact enabled tag after canonical casing", () => {
    expect(matchActiveLocale("nl-nl", ["nl-NL", "en-US"])).toBe("nl-NL");
    expect(matchActiveLocale("nl", ["nl-NL", "en-US"])).toBeNull();
    expect(matchActiveLocale("en-US", ["en"])).toBeNull();
    expect(matchActiveLocale("en", ["en"])).toBe("en");
  });
});

describe("pickLocaleFromHeader", () => {
  it("picks an exact tag from Accept-Language, not a language family", () => {
    expect(pickLocaleFromHeader("nl-NL,en;q=0.8", ["nl-NL", "en-US"])).toBe("nl-NL");
    expect(pickLocaleFromHeader("nl,en;q=0.8", ["nl-NL", "en-US"])).toBeNull();
    expect(pickLocaleFromHeader("en-US,en;q=0.9", ["en"])).toBe("en");
  });
});

describe("displayLocaleCode", () => {
  it("shows the full tag", () => {
    expect(displayLocaleCode("nl-NL")).toBe("NL-NL");
    expect(displayLocaleCode("en-US")).toBe("EN-US");
    expect(displayLocaleCode("en")).toBe("EN");
  });
});

describe("localePath", () => {
  it("omits the prefix for the default locale", () => {
    expect(localePath("en", "/contact", "en")).toBe("/contact");
    expect(localePath("en", "/", "en")).toBe("/");
    expect(localePath("en-US", "/contact", "en-US")).toBe("/contact");
  });

  it("prefixes non-default locales with the stored tag", () => {
    expect(localePath("nl", "/contact", "en")).toBe("/nl/contact");
    expect(localePath("nl", "/", "en")).toBe("/nl");
    expect(localePath("nl-NL", "/contact", "en-US")).toBe("/nl-NL/contact");
    expect(localePath("nl-NL", "/", "en-US")).toBe("/nl-NL");
  });
});

describe("parseLocalePrefix", () => {
  it("strips a known locale prefix", () => {
    expect(parseLocalePrefix("/nl/about-us", ["en", "nl"])).toEqual({
      locale: "nl",
      restPath: "/about-us",
    });
    expect(parseLocalePrefix("/nl", ["en", "nl"])).toEqual({
      locale: "nl",
      restPath: "/",
    });
    expect(parseLocalePrefix("/nl-NL/about-us", ["en-US", "nl-NL"])).toEqual({
      locale: "nl-NL",
      restPath: "/about-us",
    });
  });

  it("does not treat a language-only prefix as a regional locale", () => {
    expect(parseLocalePrefix("/nl/about-us", ["en-US", "nl-NL"])).toEqual({
      locale: null,
      restPath: "/nl/about-us",
    });
  });

  it("leaves unprefixed paths alone", () => {
    expect(parseLocalePrefix("/contact", ["en", "nl"])).toEqual({
      locale: null,
      restPath: "/contact",
    });
  });
});

describe("localizePublicPath", () => {
  const active = ["en", "nl"];

  it("keeps the current locale on internal page paths", () => {
    expect(localizePublicPath("/contact", "nl", "en", active)).toBe("/nl/contact");
    expect(localizePublicPath("/nl/contact", "nl", "en", active)).toBe("/nl/contact");
    expect(localizePublicPath("/nl/contact", "en", "en", active)).toBe("/contact");
  });

  it("prefixes regional tags as stored", () => {
    const regional = ["en-US", "nl-NL"];
    expect(localizePublicPath("/contact", "nl-NL", "en-US", regional)).toBe("/nl-NL/contact");
    expect(localizePublicPath("/nl-NL/contact", "en-US", "en-US", regional)).toBe("/contact");
  });

  it("leaves external URLs, hashes, and app routes unchanged", () => {
    expect(localizePublicPath("https://example.com", "nl", "en", active)).toBe("https://example.com");
    expect(localizePublicPath("#", "nl", "en", active)).toBe("#");
    expect(localizePublicPath("/login", "nl", "en", active)).toBe("/login");
    expect(localizePublicPath("/admin", "nl", "en", active)).toBe("/admin");
  });
});
