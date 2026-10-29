// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_SECRET = "test-secret-that-is-at-least-32-characters-long";

interface Row {
  totp_secret: string | null;
  totp_confirmed_at: string | null;
  totp_recovery_codes: string | null;
  totp_last_step: number | null;
}

let row: Row;
let reads = 0;

interface FakeDb {
  query(): Promise<Row[]>;
  execute(sql: string, params?: unknown[]): Promise<number>;
  run(): Promise<void>;
  transaction<T>(fn: (tx: FakeDb) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const fakeDb: FakeDb = {
  async query(): Promise<Row[]> {
    reads += 1;
    if (reads === 1) await new Promise((resolve) => setTimeout(resolve, 30));
    return [{ ...row }];
  },
  async execute(sql: string, params: unknown[] = []): Promise<number> {
    if (sql.includes("totp_last_step = ?") && sql.includes("totp_last_step <")) {
      const step = Number(params[0]);
      if (row.totp_last_step != null && row.totp_last_step >= step) return 0;
      row.totp_last_step = step;
      return 1;
    }
    if (sql.includes("totp_recovery_codes = ?") && sql.includes("totp_recovery_codes = ?")) {
      const [next, , , previous] = params;
      if (row.totp_recovery_codes !== previous) return 0;
      row.totp_recovery_codes = String(next);
      return 1;
    }
    return 0;
  },
  async run(): Promise<void> {},
  async transaction<T>(fn: (tx: typeof fakeDb) => Promise<T>): Promise<T> {
    return fn(fakeDb);
  },
  async close(): Promise<void> {},
};

vi.mock("../../../src/lib/database/db.js", () => ({ getDb: async () => fakeDb }));

const { encryptSecret } = await import("../../../src/lib/security/secret-box.js");
const { TotpUnavailableError, claimTotpStep, consumeRecoveryCode, getTotpState } = await import(
  "../../../src/lib/auth/totp-db.js"
);

beforeEach(() => {
  reads = 0;
  row = {
    totp_secret: encryptSecret("JBSWY3DPEHPK3PXP"),
    totp_confirmed_at: "2026-01-01 00:00:00",
    totp_recovery_codes: encryptSecret(JSON.stringify(["ABCD2-EFGH3", "JK4LM-NP5QR"])),
    totp_last_step: null,
  };
});

describe("getTotpState", () => {
  it("does not treat a secret that cannot be decrypted as turned off", async () => {
    row.totp_secret = "enc:v1:not-a-real-ciphertext";
    await expect(getTotpState("user", "site")).rejects.toBeInstanceOf(TotpUnavailableError);
  });

  it("reports a user with no factor as not enrolled", async () => {
    row = { totp_secret: null, totp_confirmed_at: null, totp_recovery_codes: null, totp_last_step: null };
    const state = await getTotpState("user", "site");
    expect(state.enabled).toBe(false);
  });
});

describe("one-time authenticator claims", () => {
  it("lets only the first claim of a step succeed", async () => {
    expect(await claimTotpStep("user", "site", 10)).toBe(true);
    expect(await claimTotpStep("user", "site", 10)).toBe(false);
    expect(await claimTotpStep("user", "site", 11)).toBe(true);
  });

  it("keeps both recovery codes spent when two claims overlap", async () => {
    const [first, second] = await Promise.all([
      consumeRecoveryCode("user", "site", "ABCD2-EFGH3"),
      consumeRecoveryCode("user", "site", "JK4LM-NP5QR"),
    ]);
    expect(first).toBe(true);
    expect(second).toBe(true);
    const state = await getTotpState("user", "site");
    expect(state.recoveryCodes).toEqual([]);
  });
});
