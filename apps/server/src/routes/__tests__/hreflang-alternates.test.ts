import { describe, expect, it } from "vitest";
import { hreflangAlternates } from "../public-site.js";

const ACTIVE = ["nl-NL", "en-US"];
const DEFAULT = "nl-NL";

describe("hreflangAlternates", () => {
  it("returns nothing for a single-language site", () => {
    expect(
      hreflangAlternates({
        activeLocales: ["nl-NL"],
        defaultLocale: DEFAULT,
        currentPath: "/over-ons",
        translations: [{ locale: "nl-NL", slug: "over-ons" }],
      }),
    ).toEqual([]);
  });

  it("lists every active locale plus x-default for the home page", () => {
    expect(
      hreflangAlternates({
        activeLocales: ACTIVE,
        defaultLocale: DEFAULT,
        currentPath: "/",
        translations: [],
      }),
    ).toEqual([
      { locale: "nl-NL", href: "/" },
      { locale: "en-US", href: "/en-US" },
      { locale: "x-default", href: "/" },
    ]);
  });

  // The English URL is served (as a fallback to the default language) even
  // though only the Dutch row exists, so it must still be referenced — with the
  // locale prefix — and the page must reference itself.
  it("reuses the current path for a locale with no translated row", () => {
    expect(
      hreflangAlternates({
        activeLocales: ACTIVE,
        defaultLocale: DEFAULT,
        currentPath: "/over-ons",
        translations: [{ locale: "nl-NL", slug: "over-ons" }],
      }),
    ).toEqual([
      { locale: "nl-NL", href: "/over-ons" },
      { locale: "en-US", href: "/en-US/over-ons" },
      { locale: "x-default", href: "/over-ons" },
    ]);
  });

  it("uses each locale's own slug when a real translation exists", () => {
    expect(
      hreflangAlternates({
        activeLocales: ACTIVE,
        defaultLocale: DEFAULT,
        currentPath: "/about-us",
        translations: [
          { locale: "nl-NL", slug: "over-ons" },
          { locale: "en-US", slug: "about-us" },
        ],
      }),
    ).toEqual([
      { locale: "nl-NL", href: "/over-ons" },
      { locale: "en-US", href: "/en-US/about-us" },
      { locale: "x-default", href: "/over-ons" },
    ]);
  });
});
