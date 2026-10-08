// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../../src/lib/database/db.js";

vi.mock("../../../src/lib/plugins/plugin-kv.js", () => ({
  PLUGIN_HOST_SCHEMA_ITEM: "schema",
  PLUGIN_HOST_SCHEMA_PASSWORD_ITEM: "password",
  getPluginHostItem: async () => undefined,
}));

const { createPluginDatabasesApi } = await import("../../../src/lib/plugins/plugin-databases.js");

/**
 * Run with a disposable database:
 *   PLUGIN_ROWS_TEST_DATABASE=1 DB_NAME=plugin_rows_test DB_DRIVER=postgres|mysql|mariadb \
 *   DB_HOST=… DB_USER=… DB_PASSWORD=… pnpm vitest run tests/integration/database/plugin-rows-db.integration.test.ts
 */
const enabled =
  process.env.PLUGIN_ROWS_TEST_DATABASE === "1" && process.env.DB_NAME === "plugin_rows_test";

describe.skipIf(!enabled)("plugin row transactions", () => {
  const siteId = randomUUID();
  const otherSite = randomUUID();
  const shop = createPluginDatabasesApi("justflows.shop", siteId, new Set());
  const pg = process.env.DB_DRIVER === "postgres";

  beforeAll(async () => {
    const db = await getDb();
    const uuid = pg ? "UUID" : "CHAR(36)";
    await db.run("DROP TABLE IF EXISTS shop_inventory");
    await db.run("DROP TABLE IF EXISTS shop_claims");
    await db.run(
      `CREATE TABLE shop_inventory (id ${uuid} PRIMARY KEY, site_id ${uuid} NOT NULL, available INT NOT NULL, reserved INT NOT NULL, variation_id ${uuid} NULL)`,
    );
    await db.run(
      `CREATE TABLE shop_claims (id ${uuid} PRIMARY KEY, site_id ${uuid} NOT NULL, claim_key VARCHAR(64) NOT NULL, UNIQUE (site_id, claim_key))`,
    );
  });

  afterAll(async () => {
    const db = await getDb();
    await db.run("DROP TABLE IF EXISTS shop_inventory");
    await db.run("DROP TABLE IF EXISTS shop_claims");
    await db.close();
  });

  beforeEach(async () => {
    const db = await getDb();
    await db.run("DELETE FROM shop_inventory");
    await db.run("DELETE FROM shop_claims");
  });

  it("sells scarce stock exactly once under concurrent transactions", async () => {
    const id = randomUUID();
    await shop.insert("inventory", { id, available: 5, reserved: 0, variation_id: null });
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        shop
          .transaction(async (tx) => {
            const row = await tx.findOne("inventory", { id }, { lock: true });
            if (!row) throw new Error("missing");
            const moved = await tx.increment(
              "inventory",
              { id },
              { available: -1, reserved: 1 },
              { min: { available: 0 } },
            );
            if (moved !== 1) throw new Error("sold out");
            return true;
          })
          .catch(() => false),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(await shop.findOne("inventory", { id })).toMatchObject({ available: 5 - 5, reserved: 5 });
  });

  it("guards stock without a transaction too", async () => {
    const id = randomUUID();
    await shop.insert("inventory", { id, available: 3, reserved: 0, variation_id: null });
    const moved = await Promise.all(
      Array.from({ length: 10 }, () => shop.increment("inventory", { id }, { available: -1 }, { min: { available: 0 } })),
    );
    expect(moved.reduce((sum, n) => sum + n, 0)).toBe(3);
  });

  it("claims a unique key once, including inside a transaction", async () => {
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => shop.insert("claims", { id: randomUUID(), claim_key: "evt_1" })),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    const inner = await shop.transaction(async (tx) => {
      const again = await tx.insert("claims", { id: randomUUID(), claim_key: "evt_1" });
      const fresh = await tx.insert("claims", { id: randomUUID(), claim_key: "evt_2" });
      return [again, fresh];
    });
    expect(inner).toEqual([false, true]);
  });

  it("rolls back every write when the callback throws", async () => {
    const id = randomUUID();
    await expect(
      shop.transaction(async (tx) => {
        await tx.insert("inventory", { id, available: 1, reserved: 0 });
        await shop.update("inventory", { id }, { available: 9 });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await shop.findOne("inventory", { id })).toBeUndefined();
  });

  it("uses matched rows for compare-and-set and IS NULL filters", async () => {
    const id = randomUUID();
    await shop.insert("inventory", { id, available: 2, reserved: 0, variation_id: null });
    expect(await shop.update("inventory", { id, available: 2 }, { available: 2 })).toBe(1);
    expect(await shop.update("inventory", { id, available: 7 }, { available: 1 })).toBe(0);
    expect(await shop.find("inventory", { variation_id: null })).toHaveLength(1);
  });

  it("keeps sites apart", async () => {
    const other = createPluginDatabasesApi("justflows.shop", otherSite, new Set());
    const id = randomUUID();
    await shop.insert("inventory", { id, available: 4, reserved: 0 });
    expect(await other.findOne("inventory", { id })).toBeUndefined();
    expect(await other.increment("inventory", { id }, { available: -1 })).toBe(0);
    expect(await other.update("inventory", { id }, { available: 0 })).toBe(0);
    expect(await shop.findOne("inventory", { id })).toMatchObject({ available: 4 });
  });
});
