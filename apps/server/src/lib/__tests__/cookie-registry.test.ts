import { describe, it, expect } from "vitest";
import { googleTagCookies, CORE_COOKIES } from "../cookie-registry.js";

describe("googleTagCookies", () => {
  it("declares the GA4 cookie set for a G- tag", () => {
    const names = googleTagCookies("G-269ME4729K").map((c) => c.name);
    expect(names).toEqual(["_ga", "_ga_*", "_gid", "_gat_*"]);
    expect(googleTagCookies("g-abc").every((c) => c.category === "analytics")).toBe(true);
    expect(googleTagCookies("G-X").every((c) => c.provider === "Google")).toBe(true);
  });

  it("adds the Google Ads conversion-linker cookie for AW-/DC-/GTM- tags", () => {
    const gcl = googleTagCookies("AW-12345").find((c) => c.name === "_gcl_au");
    expect(gcl?.category).toBe("marketing");
    expect(googleTagCookies("GTM-ABCD").some((c) => c.name === "_gcl_au")).toBe(true);
    expect(googleTagCookies("G-ABCD").some((c) => c.name === "_gcl_au")).toBe(false);
  });
});

describe("CORE_COOKIES", () => {
  it("covers session, CSRF, and locale", () => {
    expect(CORE_COOKIES.map((c) => c.name).sort()).toEqual(["jf_csrf", "jf_locale", "jf_session"]);
    expect(CORE_COOKIES.find((c) => c.name === "jf_session")?.category).toBe("necessary");
    expect(CORE_COOKIES.find((c) => c.name === "jf_locale")?.category).toBe("preferences");
  });
});
