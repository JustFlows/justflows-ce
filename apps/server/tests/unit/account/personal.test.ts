// SPDX-License-Identifier: MIT
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ row: { id: "u-1", birth_date: null as string | null } as { id: string; birth_date: string | null } | null, run: vi.fn(), audit: vi.fn(), emit: vi.fn() }));
vi.mock("../../../src/lib/database/db.js", () => ({ getDb: async () => ({ query: async () => (mocks.row ? [mocks.row] : []), run: mocks.run }) }));
vi.mock("../../../src/lib/tenancy/context.js", () => ({ getTenantContext: () => null }));
vi.mock("../../../src/lib/security/audit-log.js", () => ({ auditLog: mocks.audit }));
vi.mock("../../../src/lib/auth/users-admin.js", () => ({ emitUserEvent: mocks.emit }));
const { readPersonal, savePersonal, validBirthDate } = await import("../../../src/lib/account/personal.js");

describe("date of birth", () => {
  it("accepts real past dates only", () => {
    expect(validBirthDate("2018-03-01", "2026-11-17")).toBe("2018-03-01");
    expect(validBirthDate("", "2026-11-17")).toBeNull();
    expect(validBirthDate(null, "2026-11-17")).toBeNull();
    expect(validBirthDate("2018-02-30", "2026-11-17")).toBeUndefined();
    expect(validBirthDate("2027-01-01", "2026-11-17")).toBeUndefined();
    expect(validBirthDate("1899-12-31", "2026-11-17")).toBeUndefined();
    expect(validBirthDate("01-03-2018", "2026-11-17")).toBeUndefined();
  });

  it("reads and saves only the member's own row, and reports whether it changed", async () => {
    mocks.row = { id: "u-1", birth_date: null };
    expect(await readPersonal("s", "u-1")).toEqual({ birthDate: null });
    expect(await savePersonal("s", "u-1", { birthDate: "1990-05-04" })).toEqual({ found: true, changed: true });
    expect(mocks.run).toHaveBeenCalledWith(expect.stringContaining("UPDATE users SET birth_date = ?"), ["1990-05-04", expect.any(String), "u-1"]);
    mocks.row = { id: "u-1", birth_date: "1990-05-04" };
    expect(await savePersonal("s", "u-1", { birthDate: "1990-05-04" })).toEqual({ found: true, changed: false });
    mocks.row = null;
    expect(await savePersonal("s", "u-2", { birthDate: null })).toEqual({ found: false, changed: false });
  });
});

describe("account routes", () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    vi.doMock("../../../src/middleware/auth.js", async (original) => ({ ...(await original() as object), requireSession: (req: express.Request, _res: express.Response, next: express.NextFunction) => { (req as unknown as { session: object }).session = { userId: "u-1", siteId: "s", role: "subscriber", email: "a@example.com" }; next(); } }));
    const { apiRouter } = await import("../../../src/routes/public/account.js");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { session: object }).session = { userId: "u-1", siteId: "s", role: "subscriber", email: "a@example.com" }; next(); });
    app.use("/api/account", apiRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/account`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => { mocks.row = { id: "u-1", birth_date: null }; mocks.audit.mockReset(); mocks.emit.mockReset(); mocks.run.mockReset(); });

  it("saves a valid date, audits it without the value, and tells plugins", async () => {
    const put = (birthDate: unknown) => fetch(`${base}/personal`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ birthDate }) });
    expect((await put("2030-01-01")).status).toBe(400);
    const ok = await put("1990-05-04");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ birthDate: "1990-05-04" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "user.birth_date_changed", detail: "set" }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("1990-05-04");
    expect(mocks.emit).toHaveBeenCalledWith("user.updated", "u-1", "s");
  });
});
