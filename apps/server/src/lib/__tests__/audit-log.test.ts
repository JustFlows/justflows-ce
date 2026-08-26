import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";

interface Row {
  sql: string;
  params: unknown[];
}

let statements: Row[] = [];
let failNext = false;

const fakeDb = {
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    statements.push({ sql, params });
    if (/FROM audit_log/i.test(sql)) {
      return [
        {
          id: "e1",
          occurred_at: "2026-08-26 10:00:00",
          action: "auth.login",
          outcome: "success",
          actor_email: "a@example.com",
          actor_role: "administrator",
          target: null,
          ip: "203.0.113.7",
          detail: null,
        },
      ] as unknown as T[];
    }
    return [] as T[];
  },
  async run(sql: string, params: unknown[] = []): Promise<void> {
    if (failNext) {
      failNext = false;
      throw new Error("relation \"audit_log\" does not exist");
    }
    statements.push({ sql, params });
  },
  async close(): Promise<void> {},
};

vi.mock("../db.js", () => ({ getDb: async () => fakeDb, resetDb: () => {} }));

const { auditLog, listAuditLog, pruneAuditLog, AUDIT_ACTIONS } = await import("../audit-log.js");

beforeEach(() => {
  statements = [];
  failNext = false;
});

const base = { siteId: "site-1", action: "auth.login" as const };

describe("writing an entry", () => {
  it("records the fields an investigator needs", async () => {
    await auditLog({
      ...base,
      actorId: "u1",
      actorEmail: "a@example.com",
      actorRole: "administrator",
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0",
    });

    const insert = statements.find((s) => /INSERT INTO audit_log/i.test(s.sql));
    expect(insert).toBeTruthy();
    expect(insert!.params).toContain("site-1");
    expect(insert!.params).toContain("auth.login");
    expect(insert!.params).toContain("a@example.com");
    expect(insert!.params).toContain("203.0.113.7");
    expect(insert!.sql).toContain("metadata");
    expect(insert!.sql).toContain("'{}'");
  });

  it("defaults the outcome to success", async () => {
    await auditLog(base);
    const insert = statements.find((s) => /INSERT INTO audit_log/i.test(s.sql))!;
    expect(insert.params).toContain("success");
  });

  // An audit write must never be able to fail the action it describes. A site
  // that stops working because logging broke is the worse outcome, and the gap
  // in the log is visible either way.
  it("never throws into the caller when the table is missing", async () => {
    failNext = true;
    await expect(auditLog(base)).resolves.toBeUndefined();
  });

  it("strips control characters that could forge a log line", async () => {
    await auditLog({ ...base, detail: "role=admin\nauth.login success\r\n", target: "a\0b" });
    const insert = statements.find((s) => /INSERT INTO audit_log/i.test(s.sql))!;
    const joined = insert.params.filter((p) => typeof p === "string").join("|");
    expect(joined).not.toContain("\n");
    expect(joined).not.toContain("\r");
    expect(joined).not.toContain("\0");
  });

  it("truncates to the column widths", async () => {
    await auditLog({ ...base, actorEmail: "x".repeat(500), detail: "y".repeat(5000) });
    const insert = statements.find((s) => /INSERT INTO audit_log/i.test(s.sql))!;
    const email = insert.params[6] as string;
    const detail = insert.params[11] as string;
    expect(email.length).toBeLessThanOrEqual(320);
    expect(detail.length).toBeLessThanOrEqual(2000);
  });
});

describe("the recorded action set", () => {
  it("covers every surface that can run code or change privilege", () => {
    for (const action of [
      "auth.login",
      "auth.login_failed",
      "user.role_changed",
      "plugin.installed",
      "theme.installed",
      "core.updated",
      "security.headers_changed",
    ]) {
      expect(AUDIT_ACTIONS).toContain(action);
    }
  });
});

describe("reading the trail", () => {
  it("scopes to the site and orders newest first", async () => {
    await listAuditLog({ siteId: "site-1" });
    const read = statements.find((s) => /SELECT \* FROM audit_log/i.test(s.sql))!;
    expect(read.sql).toContain("site_id = ?");
    expect(read.sql).toContain("ORDER BY occurred_at DESC");
    expect(read.params[0]).toBe("site-1");
  });

  it("clamps the page size so one call cannot pull the whole table", async () => {
    await listAuditLog({ siteId: "site-1", limit: 100_000 });
    const read = statements.find((s) => /SELECT \* FROM audit_log/i.test(s.sql))!;
    expect(read.params[read.params.length - 1]).toBe(500);
  });

  it("maps rows to camelCase for the API", async () => {
    const rows = await listAuditLog({ siteId: "site-1" });
    expect(rows[0]).toMatchObject({
      action: "auth.login",
      actorEmail: "a@example.com",
      ip: "203.0.113.7",
    });
  });
});

describe("retention", () => {
  // The trail holds IP addresses, so it is personal data and cannot be kept
  // indefinitely — GDPR Art. 5(1)(e).
  it("deletes by a cutoff derived from the retention window", async () => {
    const removed = await pruneAuditLog("site-1", 30);

    // The fixture returns one row for any audit_log read, so the sweep finds it
    // stale and reports it.
    expect(removed).toBe(1);

    const del = statements.find((s) => /DELETE FROM audit_log/i.test(s.sql))!;
    expect(del.sql).toContain("site_id = ?");
    expect(del.params[0]).toBe("site-1");

    // Both statements must use the same cutoff, or the sweep counts one set of
    // rows and deletes another.
    const scan = statements.find((s) => /SELECT id FROM audit_log/i.test(s.sql))!;
    expect(del.params[1]).toBe(scan.params[1]);

    const age = (Date.now() - Date.parse(String(scan.params[1]).replace(" ", "T") + "Z")) / 86_400_000;
    expect(age).toBeGreaterThan(29);
    expect(age).toBeLessThan(31);
  });

  it("issues no delete when nothing is stale", async () => {
    // Same shape as a site whose log is all inside the window.
    const original = fakeDb.query;
    (fakeDb as { query: unknown }).query = async (sql: string) =>
      /SELECT id FROM audit_log/i.test(sql) ? [] : original.call(fakeDb, sql, []);
    statements = [];

    expect(await pruneAuditLog("site-1", 30)).toBe(0);
    expect(statements.find((s) => /DELETE FROM audit_log/i.test(s.sql))).toBeUndefined();

    (fakeDb as { query: unknown }).query = original;
  });

  it("honours JF_AUDIT_RETENTION_DAYS", async () => {
    const prev = process.env.JF_AUDIT_RETENTION_DAYS;
    process.env.JF_AUDIT_RETENTION_DAYS = "7";
    const { auditRetentionDays } = await import("../audit-log.js");
    expect(auditRetentionDays()).toBe(7);
    if (prev === undefined) delete process.env.JF_AUDIT_RETENTION_DAYS;
    else process.env.JF_AUDIT_RETENTION_DAYS = prev;
  });
});
