import { describe, it, expect } from "vitest";
import { CORE_COOKIES, getCoreCookies } from "../../../src/lib/security/cookie-registry.js";

describe("CORE_COOKIES", () => {
  it("covers session, CSRF, and locale", () => {
    expect(CORE_COOKIES.map((c) => c.name).sort()).toEqual(["jf_csrf", "jf_locale", "jf_session"]);
    expect(CORE_COOKIES.find((c) => c.name === "jf_session")?.category).toBe("necessary");
    expect(CORE_COOKIES.find((c) => c.name === "jf_locale")?.category).toBe("preferences");
  });
});

describe("getCoreCookies", () => {
  it("lists only the host's own cookies; plugins declare what their markup causes", async () => {
    expect((await getCoreCookies()).map((c) => c.name).sort()).toEqual(["jf_csrf", "jf_locale", "jf_session"]);
  });
});
