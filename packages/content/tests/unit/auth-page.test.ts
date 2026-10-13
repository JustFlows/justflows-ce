// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import { AUTH_PAGE_SLUGS, defaultAuthBlocks, seedAuthPages } from "../../src/service/auth-page.js";
import { contentTypePolicy, publicContentTypeSql } from "../../src/service/content-types.js";

describe("core member auth pages", () => {
  it("are open to visitors but never cached, listed or exported", () => {
    expect(contentTypePolicy("auth")).toEqual({ requiresAuthentication: false, cacheable: false, publiclyDiscoverable: false, exportable: false });
    expect(publicContentTypeSql()).toBe("type NOT IN ('account', 'auth')");
  });
  it("seeds one published page per flow, each with its own form", async () => {
    const db = { query: vi.fn().mockResolvedValue([]), run: vi.fn().mockResolvedValue(undefined) };
    await seedAuthPages(db, "site-a", "nl-NL");
    expect(AUTH_PAGE_SLUGS).toEqual(["login", "register", "forgot-password", "reset-password"]);
    expect(db.run).toHaveBeenCalledTimes(4);
    for (const slug of AUTH_PAGE_SLUGS) {
      expect(db.run).toHaveBeenCalledWith(expect.stringContaining("'auth', 'published'"), [expect.any(String), "site-a", slug, expect.any(String), JSON.stringify(defaultAuthBlocks(slug)), "nl-NL", expect.any(String), expect.any(String), expect.any(String)]);
      expect(defaultAuthBlocks(slug).blocks.at(-1)).toMatchObject({ type: "core.auth-form", props: { form: slug } });
    }
  });
  it("only adds the pages that are missing, in any state", async () => {
    const db = { query: vi.fn().mockResolvedValue([{ slug: "login" }, { slug: "register" }]), run: vi.fn() };
    await seedAuthPages(db, "site-a", "en");
    expect(db.run).toHaveBeenCalledTimes(2);
    expect(db.run.mock.calls.map((call) => call[1][2])).toEqual(["forgot-password", "reset-password"]);
  });
});
