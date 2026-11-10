// SPDX-License-Identifier: MIT
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  owner: vi.fn(),
  send: vi.fn(async () => ({ ok: true })),
  audit: vi.fn(async () => undefined),
}));
vi.mock("../../../src/lib/database/db.js", () => ({ getControlDb: async () => ({ query: mocks.query }) }));
vi.mock("../../../src/lib/tenancy/platform-account.js", () => ({ ownerAccount: mocks.owner }));
vi.mock("../../../src/lib/email/mail.js", () => ({ sendTemplateMail: mocks.send }));
vi.mock("../../../src/lib/security/audit-log.js", () => ({ auditLog: mocks.audit }));
const { processFindSites } = await import("../../../src/lib/tenancy/find-sites.js");
const ctx = { ip: "192.0.2.1", userAgent: "test", appUrl: "https://platform.example.com/" };
const root = [{ id: "root", url: "https://root.example.com" }];
const owner = [{ id: "u1", email: "owner@example.com", display_name: "Owner", site_id: "root" }];
beforeEach(() => {
  mocks.query.mockReset();
  mocks.owner.mockReset();
  mocks.send.mockClear();
  mocks.audit.mockClear();
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
it("mails the stored address the sites of every owned workspace", async () => {
  mocks.query.mockResolvedValueOnce(root).mockResolvedValueOnce(owner);
  mocks.owner.mockResolvedValue([
    { id: "w1", sites: [{ id: "s1", name: "Shopora", status: "active", url: "https://shopora.example.com" }] },
    { id: "w2", sites: [{ id: "s2", name: "Old\nblog", status: "suspended", url: "https://blog.example.com" }] },
  ]);
  await processFindSites(" Owner@Example.com ", ctx);
  expect(mocks.query).toHaveBeenLastCalledWith(expect.any(String), ["root", "owner@example.com"]);
  expect(mocks.owner).toHaveBeenCalledWith("u1");
  expect(mocks.send).toHaveBeenCalledWith({
    to: "owner@example.com",
    key: "core.owned-sites",
    values: {
      display_name: "Owner",
      site_list: "Shopora: https://shopora.example.com\nOld blog: https://blog.example.com (suspended)",
      action_url: "https://platform.example.com/account",
    },
  });
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "workspace.sites_requested", outcome: "success", siteId: "root" }));
});
it("falls back to the root site URL and never mails a link without a trusted origin", async () => {
  const site = [{ id: "w1", sites: [{ id: "s1", name: "Shopora", status: "active", url: "https://shopora.example.com" }] }];
  mocks.query.mockResolvedValueOnce(root).mockResolvedValueOnce(owner);
  mocks.owner.mockResolvedValue(site);
  await processFindSites("owner@example.com", { ...ctx, appUrl: "" });
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ values: expect.objectContaining({ action_url: "https://root.example.com/account" }) }));
  mocks.send.mockClear();
  mocks.query.mockResolvedValueOnce([{ id: "root", url: "javascript:alert(1)" }]).mockResolvedValueOnce(owner);
  await processFindSites("owner@example.com", { ...ctx, appUrl: "" });
  expect(mocks.send).not.toHaveBeenCalled();
});
