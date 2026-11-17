// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrivacyProvider } from "@justflows/sdk";

const users = [{ id: "u-1", email: "Ada@Example.com", username: "ada", display_name: "Ada", role: "subscriber", site_id: "site-1" }];
const runs: Array<{ sql: string; params: unknown[] }> = [];
let providers: unknown[] = [];
const applyFilter = vi.fn(async () => providers);
const auditLog = vi.fn();

vi.mock("../../../src/lib/database/db.js", () => ({
  getDb: async () => ({
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("FROM users WHERE id")) return users.filter((user) => user.id === params[0] && user.site_id === params[1]);
      if (sql.includes("FROM users WHERE LOWER(email)")) return users.filter((user) => user.email.toLowerCase() === params[0] && user.site_id === params[1]);
      if (sql.includes("FROM comments")) return params[1] === "ada@example.com" ? [{ id: "c-1", author_email: "ada@example.com" }] : [];
      if (sql.includes("FROM content")) return [{ id: "p-1" }];
      if (sql.includes("FROM audit_log")) return [{ id: "a-1" }];
      return [];
    },
    run: async (sql: string, params: unknown[]) => void runs.push({ sql, params }),
  }),
}));
vi.mock("../../../src/lib/plugins/plugin-runtime.js", () => ({ ensurePluginRuntime: async () => undefined, getRuntimeHooks: () => ({ applyFilter }) }));
vi.mock("../../../src/lib/security/audit-log.js", () => ({ auditLog }));
let retentionYears: unknown = null;
vi.mock("../../../src/lib/settings/site-settings.js", () => ({ getSiteSetting: async () => retentionYears }));

const { erasePersonalData, exportPersonalData } = await import("../../../src/lib/auth/personal-data.js");

const actor = { userId: "admin", role: "administrator" };

function provider(id: string, over: Partial<PrivacyProvider> = {}): PrivacyProvider {
  return {
    id,
    label: id,
    export: vi.fn(async (subject) => ({ count: 1, records: { seen: subject } })),
    erase: vi.fn(async () => ({ counts: { rows: 2 }, notes: ["Invoices kept for 7 years."] })),
    ...over,
  };
}

beforeEach(() => {
  runs.length = 0;
  auditLog.mockClear();
  applyFilter.mockClear();
});

describe("personal data requests", () => {
  it("gathers core data and every plugin's part for an account, and audits it", async () => {
    providers = [provider("acme.shop"), provider("acme.bookings"), { id: "broken" }, provider("acme.shop")];
    const data = await exportPersonalData("site-1", { userId: "u-1" }, actor);
    expect(data).toMatchObject({ subject: { userId: "u-1", email: "ada@example.com" }, content: [{ id: "p-1" }], comments: [{ id: "c-1" }], auditEntries: [{ id: "a-1" }] });
    expect(data!.plugins.map((part) => [part.id, part.ok, part.count])).toEqual([["acme.shop", true, 1], ["acme.bookings", true, 1]]);
    /** Plugins get the account id and the normalised address. */
    expect(data!.plugins[0]!.records).toEqual({ seen: { userId: "u-1", email: "ada@example.com" } });
    expect(applyFilter).toHaveBeenCalledWith("privacy.providers", [], expect.objectContaining({ siteId: "site-1" }), expect.anything());
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "privacy.exported", target: "u-1", actorId: "admin" }));
  });

  it("finds a guest by email, uses the account when the address has one, and never logs the address", async () => {
    providers = [provider("acme.bookings")];
    const guest = await exportPersonalData("site-1", { email: " Guest@Example.com " }, actor);
    expect(guest).toMatchObject({ subject: { userId: null, email: "guest@example.com", account: null }, content: [], auditEntries: [] });
    const account = await exportPersonalData("site-1", { email: "ADA@example.com" }, actor);
    expect(account!.subject.userId).toBe("u-1");
    expect(JSON.stringify(auditLog.mock.calls)).not.toContain("guest@example.com");
    expect(await exportPersonalData("site-1", { userId: "nobody" }, actor)).toBeNull();
  });

  it("erases in core and every plugin, reports a failing plugin, and keeps going", async () => {
    const failing = provider("acme.crm", { erase: vi.fn(async () => { throw new Error("crm down"); }) });
    const shop = provider("acme.shop");
    providers = [failing, shop];
    const result = await erasePersonalData("site-1", { userId: "u-1" }, null, actor);
    expect(result).toMatchObject({ contentReassigned: 1, commentsAnonymised: 1, auditEntriesAnonymised: 1 });
    expect(result!.plugins).toEqual([
      { id: "acme.crm", label: "acme.crm", ok: false, counts: {}, kept: [], notes: [], error: "crm down" },
      { id: "acme.shop", label: "acme.shop", ok: true, counts: { rows: 2 }, kept: [], notes: ["Invoices kept for 7 years."] },
    ]);
    expect(shop.erase).toHaveBeenCalledWith({ userId: "u-1", email: "ada@example.com" }, expect.objectContaining({ siteId: "site-1" }));
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "privacy.erased", target: "u-1" }));
  });

  it("erases a guest's comments and plugin data without touching accounts or content", async () => {
    const bookings = provider("acme.bookings");
    providers = [bookings];
    const result = await erasePersonalData("site-1", { email: "guest@example.com" }, null, actor);
    expect(result).toMatchObject({ contentReassigned: 0, commentsAnonymised: 0, auditEntriesAnonymised: 0 });
    expect(bookings.erase).toHaveBeenCalledWith({ userId: null, email: "guest@example.com" }, expect.anything());
    expect(runs.some((run) => run.sql.includes("content"))).toBe(false);
  });

  it("tells plugins how long financial records are kept and reports what they kept", async () => {
    retentionYears = 10;
    const shop = provider("acme.shop", { erase: vi.fn(async () => ({ counts: { addresses: 1 }, kept: [{ kind: "orders", count: 2, until: "2037-01-01T00:00:00.000Z", reason: "Invoices." }, { kind: "bad", count: 0, until: "x", reason: "" }] })) });
    providers = [shop];
    const result = await erasePersonalData("site-1", { userId: "u-1" }, null, actor);
    expect(shop.erase).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ retention: { financialRecordsYears: 10 }, requestedAt: expect.any(String) }));
    expect(result!.plugins[0]!.kept).toEqual([{ kind: "orders", count: 2, until: "2037-01-01T00:00:00.000Z", reason: "Invoices." }]);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining("kept(orders:2<2037-01-01)") }));
    retentionYears = "nonsense";
    await erasePersonalData("site-1", { userId: "u-1" }, null, actor);
    expect(shop.erase).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ retention: { financialRecordsYears: 7 } }));
    retentionYears = null;
  });
});
