// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from "vitest";

interface Account {
  usedAt: string | null;
  password: string;
  tokenVersion: number;
  liveSessions: number;
  resetRows: number;
}

function account(): Account {
  return { usedAt: null, password: "old-hash", tokenVersion: 3, liveSessions: 2, resetRows: 2 };
}

function client(state: Account, failPassword = false) {
  return {
    async transaction<T>(fn: (tx: { execute: (sql: string, params?: unknown[]) => Promise<number> }) => Promise<T>) {
      const snapshot = { ...state };
      try {
        return await fn({
          execute: async (sql, params = []) => {
            if (sql.includes("SET used_at")) {
              if (state.usedAt) return 0;
              state.usedAt = String(params[0]);
              return 1;
            }
            if (sql.includes("password_hash")) {
              if (failPassword) return 0;
              state.password = String(params[0]);
              state.tokenVersion += 1;
              return 1;
            }
            if (sql.includes("user_sessions")) {
              state.liveSessions = 0;
              return state.liveSessions;
            }
            if (sql.startsWith("DELETE FROM password_resets")) {
              state.resetRows = 0;
              return 1;
            }
            return 0;
          },
        });
      } catch (err) {
        Object.assign(state, snapshot);
        throw err;
      }
    },
  };
}

vi.mock("../../../src/lib/database/db.js", () => ({ getDb: async () => current }));

let current = client(account());
const { redeemPasswordReset } = await import("../../../src/lib/auth/password-reset-db.js");

const reset = { id: "reset-1", userId: "user-1", siteId: "site-1" };

describe("redeemPasswordReset", () => {
  it("changes the password and revokes sessions together", async () => {
    const state = account();
    current = client(state);
    await redeemPasswordReset(reset, "new-hash");
    expect(state.password).toBe("new-hash");
    expect(state.tokenVersion).toBe(4);
    expect(state.liveSessions).toBe(0);
    expect(state.resetRows).toBe(0);
  });

  it("leaves the previous password and sessions when the password write does not apply", async () => {
    const state = account();
    current = client(state, true);
    await expect(redeemPasswordReset(reset, "new-hash")).rejects.toThrow(/not updated/);
    expect(state.password).toBe("old-hash");
    expect(state.tokenVersion).toBe(3);
    expect(state.liveSessions).toBe(2);
    expect(state.usedAt).toBeNull();
    expect(state.resetRows).toBe(2);
  });
});
