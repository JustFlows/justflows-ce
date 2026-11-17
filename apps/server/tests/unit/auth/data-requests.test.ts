// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const table: Row[] = [];
const users: Row[] = [];
const settings = new Map<string, unknown>();
const mail = vi.fn(async (_input: { to: string; key: string; values: Record<string, string> }) => ({ ok: true }));
const auditLog = vi.fn();
const erase = vi.fn();
const deleteUser = vi.fn();

/** Just enough of the data_requests and users SQL the module sends. */
vi.mock("../../../src/lib/database/db.js", () => ({
  getDb: async () => ({
    query: async (sql: string, params: unknown[]) => {
      if (sql.startsWith("SELECT * FROM data_requests WHERE site_id = ? AND user_id = ?")) return table.filter((row) => row.site_id === params[0] && row.user_id === params[1] && row.status === "pending");
      if (sql.startsWith("SELECT * FROM data_requests WHERE id = ?")) return table.filter((row) => row.id === params[0] && row.site_id === params[1]);
      if (sql.includes("status = 'pending' ORDER BY due_at")) return table.filter((row) => row.site_id === params[0] && row.status === "pending");
      if (sql.includes("status <> 'pending'")) return table.filter((row) => row.site_id === params[0] && row.status !== "pending");
      if (sql.includes("FROM users")) return users.filter((user) => user.site_id === (sql.includes("id IN") ? params[0] : params[1]) && (sql.includes("id IN") ? params.slice(1).includes(user.id) : user.id === params[0]));
      return [];
    },
    run: async (sql: string, params: unknown[]) => {
      if (sql.startsWith("INSERT INTO data_requests")) {
        const [id, site_id, user_id, email, address_ref, note, requested_at, due_at] = params;
        table.push({ id, site_id, kind: "erasure", user_id, email, address_ref, status: "pending", note, outcome: null, requested_at, due_at, handled_at: null, handled_by: null });
        return;
      }
      const row = table.find((candidate) => candidate.id === params[params.length - 2] && candidate.site_id === params[params.length - 1]);
      if (!row) return;
      if (sql.includes("SET outcome = ? WHERE")) { row.outcome = params[0]; return; }
      if (row.status !== "pending") return;
      if (sql.includes("status = 'cancelled'")) Object.assign(row, { status: "cancelled", email: "", handled_at: params[0], handled_by: params[1] });
      if (sql.includes("status = 'completed'")) Object.assign(row, { status: "completed", email: "", outcome: params[0], handled_at: params[1], handled_by: params[2] });
      if (sql.includes("status = 'declined'")) Object.assign(row, { status: "declined", email: "", outcome: params[0], handled_at: params[1], handled_by: params[2] });
    },
  }),
}));
vi.mock("../../../src/lib/settings/site-settings.js", () => ({
  getSiteSetting: async (_site: string, key: string) => settings.get(key) ?? null,
  setSiteSetting: async (_site: string, key: string, value: unknown) => void settings.set(key, value),
}));
vi.mock("../../../src/lib/settings/general-settings.js", () => ({ getGeneralSettings: async () => ({ adminEmail: "owner@example.com" }) }));
vi.mock("../../../src/lib/email/mail.js", () => ({ sendTemplateMail: mail }));
vi.mock("../../../src/lib/email/email-asset-url.js", () => ({ emailSiteOrigin: async () => "https://site.example" }));
vi.mock("../../../src/lib/admin/admin-path.js", () => ({ getAdminPathConfig: async () => ({ path: "/admin-x" }) }));
vi.mock("../../../src/lib/security/audit-log.js", () => ({ auditLog }));
vi.mock("../../../src/lib/auth/personal-data.js", () => ({ addressReference: (email: string) => `ref-${email.trim().toLowerCase()}`, erasePersonalData: erase }));
vi.mock("../../../src/lib/auth/users-admin.js", () => ({ deleteUser }));
const preferences = new Map<string, unknown>();
vi.mock("../../../src/lib/auth/user-preferences.js", () => ({
  getUserPreference: async (userId: string, key: string) => preferences.get(`${userId}:${key}`) ?? null,
  setUserPreference: async (userId: string, key: string, value: unknown) => void preferences.set(`${userId}:${key}`, value),
}));
process.env.APP_SECRET ||= "x".repeat(40);

const requests = await import("../../../src/lib/auth/data-requests.js");

const member = { userId: "u-1", email: "Ada@Example.com", displayName: "Ada" };
const admin = { siteId: "site-1", userId: "admin-1", role: "administrator" };
const erased = (over: Partial<{ ok: boolean; kept: unknown[] }> = {}) => ({
  contentReassigned: 0, commentsAnonymised: 2, auditEntriesAnonymised: 1,
  plugins: [{ id: "acme.shop", label: "Shop", ok: over.ok ?? true, counts: { addresses: 3 }, kept: over.kept ?? [{ kind: "orders", count: 2, until: "2034-01-01T00:00:00.000Z", reason: "" }], notes: [], ...(over.ok === false ? { error: "down" } : {}) }],
});

beforeEach(() => {
  table.length = 0;
  users.length = 0;
  users.push({ id: "u-1", site_id: "site-1", role: "subscriber", display_name: "Ada", username: "ada" });
  settings.clear();
  preferences.clear();
  /** Most cases start from a member who already confirmed their address. */
  preferences.set("u-1:privacy.confirmed_address", { address: "ref-ada@example.com" });
  for (const fn of [mail, auditLog, erase, deleteUser]) fn.mockClear();
  erase.mockResolvedValue(erased());
  deleteUser.mockResolvedValue({ status: 200, body: { ok: true } });
});

describe("members' own data requests", () => {
  it("accepts a confirmation link only for its own member, site, and current address, before it expires", async () => {
    preferences.clear();
    const member = { siteId: "site-1", userId: "u-1", email: "ada@example.com" };
    expect(await requests.addressConfirmed("u-1", member.email)).toBe(false);
    expect(await requests.createErasureRequest("site-1", { ...member, displayName: "Ada" }, null)).toMatchObject({ ok: false, status: 403 });
    const token = requests.addressConfirmationToken("site-1", "u-1", member.email, 1_000);
    expect(await requests.redeemAddressConfirmation(token, { ...member, userId: "u-2" }, 2_000)).toBe(false);
    expect(await requests.redeemAddressConfirmation(token, { ...member, siteId: "site-2" }, 2_000)).toBe(false);
    expect(await requests.redeemAddressConfirmation(token, { ...member, email: "other@example.com" }, 2_000)).toBe(false);
    expect(await requests.redeemAddressConfirmation(token, member, 1_000 + 25 * 60 * 60 * 1000)).toBe(false);
    expect(await requests.redeemAddressConfirmation(`${token.split(".")[0]}.forged`, member, 2_000)).toBe(false);
    expect(await requests.redeemAddressConfirmation(token, member, 2_000)).toBe(true);
    expect(await requests.addressConfirmed("u-1", member.email)).toBe(true);
    /** A changed address needs a new confirmation. */
    expect(await requests.addressConfirmed("u-1", "new@example.com")).toBe(false);
  });

  it("offers downloads and removal requests unless the site turns them off, and refuses requests when off", async () => {
    expect(await requests.selfServiceSettings("site-1")).toEqual({ download: true, erasure: true });
    await requests.saveSelfServiceSettings("site-1", { erasure: false });
    expect(await requests.selfServiceSettings("site-1")).toEqual({ download: true, erasure: false });
    expect(await requests.createErasureRequest("site-1", member, null)).toMatchObject({ ok: false, status: 403 });
    expect(table).toEqual([]);
  });

  it("records one open request with a 30-day due date, tells the member and the site, and never logs the address", async () => {
    const first = await requests.createErasureRequest("site-1", member, "Please hurry");
    expect(first).toMatchObject({ ok: true, created: true, request: { userId: "u-1", email: "ada@example.com", status: "pending", note: "Please hurry" } });
    const request = (first as { request: { requestedAt: string; dueAt: string } }).request;
    expect(Date.parse(request.dueAt) - Date.parse(request.requestedAt)).toBe(30 * 24 * 60 * 60 * 1000);
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ to: member.email, key: "core.data-request-received" }));
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ to: "owner@example.com", key: "core.data-request-admin", values: { member_name: "Ada", due_date: request.dueAt.slice(0, 10), note: "Please hurry", action_url: "https://site.example/admin-x/data-requests" } }));
    /** Asking again returns the same request. */
    expect(await requests.createErasureRequest("site-1", member, null)).toMatchObject({ ok: true, created: false });
    expect(table).toHaveLength(1);
    expect(JSON.stringify(auditLog.mock.calls).toLowerCase()).not.toContain("ada@example.com");
  });

  it("lets the member withdraw an open request", async () => {
    await requests.createErasureRequest("site-1", member, null);
    expect(await requests.cancelErasureRequest("site-1", "u-1")).toBe(true);
    expect(table[0]).toMatchObject({ status: "cancelled", email: "" });
    expect(await requests.cancelErasureRequest("site-1", "u-1")).toBe(false);
  });

  it("completes a request: erases everywhere, deletes the account, tells the member what the law keeps, and forgets the address", async () => {
    await requests.createErasureRequest("site-1", member, null);
    const id = String(table[0]!.id);
    mail.mockClear();
    const result = await requests.completeErasureRequest("site-1", id, admin);
    expect(result).toMatchObject({ ok: true, request: { status: "completed", email: "" } });
    expect(erase).toHaveBeenCalledWith("site-1", { userId: "u-1" }, null, { userId: "admin-1", role: "administrator" });
    expect(deleteUser).toHaveBeenCalledWith("u-1", admin);
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ to: "ada@example.com", key: "core.data-request-completed", values: expect.objectContaining({ kept: "Shop: 2 orders, until 2034-01-01" }) }));
    expect(String(table[0]!.outcome)).toContain("Account deleted.");
    expect(await requests.completeErasureRequest("site-1", id, admin)).toMatchObject({ ok: false, status: 409 });
  });

  it("keeps the request open and the account when a plugin cannot erase, so it can be completed again", async () => {
    await requests.createErasureRequest("site-1", member, null);
    erase.mockResolvedValueOnce(erased({ ok: false }));
    const result = await requests.completeErasureRequest("site-1", String(table[0]!.id), admin);
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(table[0]).toMatchObject({ status: "pending", email: "ada@example.com" });
    expect(String(table[0]!.outcome)).toContain("Shop: failed");
  });

  it("does not remove an administrator this way, nor let an administrator complete their own request", async () => {
    users[0]!.role = "administrator";
    await requests.createErasureRequest("site-1", member, null);
    expect(await requests.completeErasureRequest("site-1", String(table[0]!.id), admin)).toMatchObject({ ok: false, status: 409 });
    users[0]!.role = "editor";
    expect(await requests.completeErasureRequest("site-1", String(table[0]!.id), { ...admin, userId: "u-1" })).toMatchObject({ ok: false, status: 409 });
    expect(erase).not.toHaveBeenCalled();
  });

  it("declines with the reason sent to the member, and lists open and handled requests apart", async () => {
    await requests.createErasureRequest("site-1", member, null);
    expect((await requests.listDataRequests("site-1", "open"))[0]).toMatchObject({ displayName: "Ada" });
    const result = await requests.declineErasureRequest("site-1", String(table[0]!.id), admin, "An order is still being delivered.");
    expect(result).toMatchObject({ ok: true, request: { status: "declined", outcome: "An order is still being delivered." } });
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({ to: "ada@example.com", key: "core.data-request-declined", values: expect.objectContaining({ reason: "An order is still being delivered." }) }));
    expect(await requests.listDataRequests("site-1", "open")).toEqual([]);
    expect(await requests.listDataRequests("site-1", "handled")).toHaveLength(1);
  });

  it("keeps requests of one site away from another", async () => {
    await requests.createErasureRequest("site-1", member, null);
    expect(await requests.completeErasureRequest("site-2", String(table[0]!.id), { ...admin, siteId: "site-2" })).toMatchObject({ ok: false, status: 404 });
    expect(await requests.listDataRequests("site-2", "open")).toEqual([]);
  });
});
