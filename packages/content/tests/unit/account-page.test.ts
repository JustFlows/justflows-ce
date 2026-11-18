// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ACCOUNT_BLOCKS, DEFAULT_ACCOUNT_DATA_BLOCKS, seedAccountPage } from "../../src/service/account-page.js";
import { contentTypePolicy } from "../../src/service/content-types.js";

describe("core account page", () => {
  it("always enforces privacy by type", () => {
    expect(contentTypePolicy("account")).toEqual({ requiresAuthentication: true, cacheable: false, publiclyDiscoverable: false, exportable: false });
    expect(contentTypePolicy("page").cacheable).toBe(true);
  });
  it("seeds a default builder document for the site's locale, and the Your data page after it", async () => {
    const db = { query: vi.fn().mockResolvedValue([]), run: vi.fn().mockResolvedValue(undefined) };
    await seedAccountPage(db, "site-a", "nl-NL");
    expect(db.run).toHaveBeenNthCalledWith(1, expect.stringContaining("'account', 'published'"), [expect.any(String), "site-a", "account", "Your account", JSON.stringify(DEFAULT_ACCOUNT_BLOCKS), "nl-NL", expect.any(String), expect.any(String), expect.any(String)]);
    expect(db.run).toHaveBeenNthCalledWith(2, expect.any(String), [expect.any(String), "site-a", "account-data", "Your data", JSON.stringify(DEFAULT_ACCOUNT_DATA_BLOCKS), "nl-NL", expect.any(String), expect.any(String), expect.any(String)]);
    /** "Your account" stays the first account page, so it keeps /account. */
    const [first, second] = db.run.mock.calls.map((call) => String((call[1] as string[])[6]));
    expect(second! > first!).toBe(true);
  });
  it.each(["renamed", "draft", "trashed"])("never replaces an existing %s account page", async () => {
    const db = { query: vi.fn().mockResolvedValue([{ type: "account", slug: "account" }, { type: "account", slug: "account-data" }]), run: vi.fn() };
    await seedAccountPage(db, "site-a", "en"); expect(db.run).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("type = 'account'"), ["site-a", "account-data"]);
  });
  it("adds Your data to a site that only has its account page, unless the address is taken", async () => {
    const db = { query: vi.fn().mockResolvedValue([{ type: "account", slug: "account" }]), run: vi.fn().mockResolvedValue(undefined) };
    await seedAccountPage(db, "site-a", "en");
    expect(db.run).toHaveBeenCalledTimes(1);
    expect(db.run.mock.calls[0]![1]).toContain("account-data");
    const taken = { query: vi.fn().mockResolvedValue([{ type: "account", slug: "account" }, { type: "page", slug: "account-data" }]), run: vi.fn() };
    await seedAccountPage(taken, "site-a", "en");
    expect(taken.run).not.toHaveBeenCalled();
  });
});
