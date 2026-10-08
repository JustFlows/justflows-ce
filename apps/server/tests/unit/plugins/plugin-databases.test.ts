// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { sql: string; params: unknown[]; tx: boolean };

const calls: Call[] = [];
let transactionFailures: unknown[] = [];

function executor(tx: boolean) {
  return {
    run: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params, tx });
    },
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params, tx });
      return [{ id: "row-1" }];
    },
    execute: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params, tx });
      return 1;
    },
  };
}

const db = {
  ...executor(false),
  transaction: vi.fn(async (fn: (tx: ReturnType<typeof executor>) => Promise<unknown>) => {
    const failure = transactionFailures.shift();
    if (failure) throw failure;
    return fn(executor(true));
  }),
  close: async () => undefined,
};

vi.mock("../../../src/lib/database/db.js", () => ({ getDb: async () => db }));
vi.mock("../../../src/lib/plugins/plugin-kv.js", () => ({
  PLUGIN_HOST_SCHEMA_ITEM: "schema",
  PLUGIN_HOST_SCHEMA_PASSWORD_ITEM: "password",
  getPluginHostItem: async () => undefined,
}));
vi.mock("../../../src/lib/plugins/request-site.js", () => ({
  pluginCallSiteId: (siteId: string) => siteId,
}));

const { createPluginDatabasesApi } = await import("../../../src/lib/plugins/plugin-databases.js");

describe("plugin database transactions", () => {
  const savedDriver = process.env.DB_DRIVER;

  beforeEach(() => {
    process.env.DB_DRIVER = "postgres";
    calls.length = 0;
    transactionFailures = [];
    db.transaction.mockClear();
  });

  afterEach(() => {
    if (savedDriver === undefined) delete process.env.DB_DRIVER;
    else process.env.DB_DRIVER = savedDriver;
  });

  const api = () => createPluginDatabasesApi("justflows.shop", "site-1", new Set());

  it("runs row calls made inside the callback on the transaction", async () => {
    const databases = api();
    await databases.transaction(async (tx) => {
      await tx.findOne("inventory", { id: "i" }, { lock: true });
      await databases.increment("inventory", { id: "i" }, { available: -1 }, { min: { available: 0 } });
      await databases.upsert("stock_movements", { id: "m", reason: "x" });
    });
    expect(calls.length).toBeGreaterThan(2);
    expect(calls.every((call) => call.tx)).toBe(true);
    expect(calls[0]?.sql).toContain("FOR UPDATE");
    expect(calls[0]?.sql).toContain(`"shop_inventory"`);
  });

  it("joins a nested transaction instead of opening another", async () => {
    const databases = api();
    await databases.transaction(async () => {
      await databases.transaction(async (inner) => {
        await inner.update("orders", { id: "o", status: "pending" }, { status: "paid" });
      });
    });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(calls[0]?.tx).toBe(true);
  });

  it("does not leak the transaction to calls made after it", async () => {
    const databases = api();
    await databases.transaction(async () => undefined);
    await databases.find("orders", { status: "paid" });
    expect(calls.at(-1)?.tx).toBe(false);
  });

  it("keeps another plugin's calls out of the transaction", async () => {
    const shop = api();
    const other = createPluginDatabasesApi("acme.other", "site-1", new Set());
    await shop.transaction(async () => {
      await other.find("rows", { id: "x" });
    });
    expect(calls.at(-1)).toMatchObject({ tx: false });
  });

  it("retries a deadlocked transaction and gives up on other errors", async () => {
    const databases = api();
    transactionFailures = [{ code: "40P01" }];
    await expect(databases.transaction(async () => "done")).resolves.toBe("done");
    expect(db.transaction).toHaveBeenCalledTimes(2);

    db.transaction.mockClear();
    transactionFailures = [new Error("boom")];
    await expect(databases.transaction(async () => "done")).rejects.toThrow("boom");
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it("propagates read errors inside a transaction but not outside", async () => {
    const databases = api();
    await expect(databases.find("orders", { "bad col": "x" })).resolves.toEqual([]);
    await expect(
      databases.transaction(async (tx) => tx.find("orders", { "bad col": "x" })),
    ).rejects.toThrow(/Invalid identifier/);
  });

  it("reports whether an insert claimed the row", async () => {
    const databases = api();
    await expect(databases.insert("claims", { id: "c", key: "k" })).resolves.toBe(true);
    expect(calls.at(-1)?.sql).toContain("ON CONFLICT DO NOTHING");
  });
});
