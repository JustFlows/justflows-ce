// SPDX-License-Identifier: MIT
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  owner: vi.fn(),
  send: vi.fn(async () => ({ ok: true })),
  audit: vi.fn(async () => undefined),
  adminPaths: new Map<string, string | null>(),
  scoped: null as string | null,
}));
vi.mock("../../../src/lib/database/db.js", () => ({ getControlDb: async () => ({ query: mocks.query }) }));
vi.mock("../../../src/lib/tenancy/platform-account.js", () => ({ ownerAccount: mocks.owner }));
vi.mock("../../../src/lib/email/mail.js", () => ({ sendTemplateMail: mocks.send }));
vi.mock("../../../src/lib/security/audit-log.js", () => ({ auditLog: mocks.audit }));
vi.mock("../../../src/lib/tenancy/site-users.js", () => ({
  withSiteUsers: async (siteId: string, fn: () => Promise<string>) => {
    const path = mocks.adminPaths.get(siteId);
    if (path === null) return { ok: false, status: 503, error: "unavailable" };
    mocks.scoped = siteId;
    try { return { ok: true, value: await fn() }; } finally { mocks.scoped = null; }
  },
}));
vi.mock("../../../src/lib/admin/admin-path.js", () => ({
  getAdminPathConfig: async () => ({ path: mocks.adminPaths.get(mocks.scoped ?? "") ?? "/admin" }),
}));
const { processFindSites } = await import("../../../src/lib/tenancy/find-sites.js");
const ctx = { ip: "192.0.2.1", userAgent: "test" };
const root = [{ id: "root" }];
const owner = [{ id: "u1", email: "owner@example.com", display_name: "Owner", site_id: "root" }];
beforeEach(() => {
  mocks.query.mockReset();
  mocks.owner.mockReset();
  mocks.send.mockClear();
  mocks.audit.mockClear();
  mocks.adminPaths.clear();
});
it("sends nothing for an address that is not a root account", async () => {
  mocks.query.mockResolvedValueOnce(root).mockResolvedValueOnce([]);
  await processFindSites("nobody@example.com", ctx);
  expect(mocks.owner).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
it("sends nothing when the owner has no live site", async () => {
  mocks.query.mockResolvedValueOnce(root).mockResolvedValueOnce(owner);
  mocks.owner.mockResolvedValue([{ id: "w1", sites: [{ id: "s1", name: "Broken", status: "active", url: null }] }]);
  await processFindSites("owner@example.com", ctx);
  expect(mocks.send).not.toHaveBeenCalled();
});
it("lists each site with its own admin sign-in address, including a custom admin path and domain", async () => {
  mocks.query.mockResolvedValueOnce(root).mockResolvedValueOnce(owner);
  mocks.owner.mockResolvedValue([
    { id: "w1", sites: [{ id: "s1", name: "Shopora", status: "active", url: "https://shopora.example.com" }] },
    { id: "w2", sites: [{ id: "s2", name: "Old\nblog", status: "suspended", url: "https://www.custom-blog.test" }] },
  ]);
  mocks.adminPaths.set("s2", "/hidden-door");
  await processFindSites(" Owner@Example.com ", ctx);
  expect(mocks.query).toHaveBeenLastCalledWith(expect.any(String), ["root", "owner@example.com"]);
  expect(mocks.send).toHaveBeenCalledWith({
    to: "owner@example.com",
    key: "core.owned-sites",
    values: {
      display_name: "Owner",
      site_list: [
        "Shopora\nSite: https://shopora.example.com\nAdmin: https://shopora.example.com/admin/login",
        "Old blog (suspended)\nSite: https://www.custom-blog.test\nAdmin: https://www.custom-blog.test/hidden-door/login",
      ].join("\n\n"),
    },
  });
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "workspace.sites_requested", outcome: "success", siteId: "root" }));
});
it("leaves out an admin address it cannot read instead of guessing one", async () => {
  mocks.query.mockResolvedValueOnce(root).mockResolvedValueOnce(owner);
  mocks.owner.mockResolvedValue([{ id: "w1", sites: [{ id: "s1", name: "Shopora", status: "active", url: "https://shopora.example.com" }] }]);
  mocks.adminPaths.set("s1", null);
  await processFindSites("owner@example.com", ctx);
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ values: expect.objectContaining({ site_list: "Shopora\nSite: https://shopora.example.com" }) }));
});
