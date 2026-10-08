// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  deleteRows,
  incrementRows,
  insertRow,
  isDuplicateKeyError,
  isRetryableTransactionError,
  selectRows,
  updateRows,
  whereClause,
} from "../../../src/lib/plugins/plugin-row-sql.js";

const SITE = "site-1";

describe("plugin row SQL", () => {
  it("scopes every filter to the site and matches null with IS NULL", () => {
    expect(whereClause(SITE, { order_id: "o1", variation_id: null }, "postgres")).toEqual({
      sql: `"site_id" = ? AND "order_id" = ? AND "variation_id" IS NULL`,
      params: [SITE, "o1"],
    });
  });

  it("ignores a caller-supplied site_id", () => {
    expect(whereClause(SITE, { site_id: "other", id: "x" }, "mysql").params).toEqual([SITE, "x"]);
  });

  it("rejects an invalid column instead of dropping the filter", () => {
    expect(() => whereClause(SITE, { "id; DROP": "x" }, "mysql")).toThrow(/Invalid identifier/);
  });

  it("orders, caps the limit and locks", () => {
    const statement = selectRows(
      "shop_inventory",
      SITE,
      { product_id: "p" },
      { limit: 5000, orderBy: [{ column: "created_at", direction: "desc" }, { column: "id" }], lock: true },
      "mysql",
    );
    expect(statement.sql).toBe(
      "SELECT * FROM `shop_inventory` WHERE `site_id` = ? AND `product_id` = ? ORDER BY `created_at` DESC, `id` ASC LIMIT 500 FOR UPDATE",
    );
  });

  it("skips unique conflicts on PostgreSQL inserts", () => {
    const statement = insertRow("shop_claims", SITE, { id: "c", key: "k" }, "postgres");
    expect(statement.sql).toBe(
      `INSERT INTO "shop_claims" ("id", "key", "site_id") VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
    );
    expect(statement.params).toEqual(["c", "k", SITE]);
    expect(insertRow("shop_claims", SITE, { id: "c" }, "mariadb").sql).not.toContain("ON CONFLICT");
  });

  it("updates as compare-and-set and never rewrites id or site", () => {
    const statement = updateRows(
      "shop_orders",
      SITE,
      { id: "o", status: "pending" },
      { status: "paid", id: "x", site_id: "y" },
      "postgres",
    );
    expect(statement).toEqual({
      sql: `UPDATE "shop_orders" SET "status" = ? WHERE "site_id" = ? AND "id" = ? AND "status" = ?`,
      params: ["paid", SITE, "o", "pending"],
    });
    expect(updateRows("shop_orders", SITE, { id: "o" }, { id: "x" }, "postgres")).toBeNull();
  });

  it("increments in one statement with a lower bound", () => {
    const statement = incrementRows(
      "shop_inventory",
      SITE,
      { id: "i" },
      { available: -3, reserved: 3 },
      { min: { available: 0 }, set: { updated_at: "now" } },
      "mysql",
    );
    expect(statement).toEqual({
      sql:
        "UPDATE `shop_inventory` SET `available` = `available` + ?, `reserved` = `reserved` + ?, `updated_at` = ?" +
        " WHERE `site_id` = ? AND `id` = ? AND `available` + ? >= ?",
      params: [-3, 3, "now", SITE, "i", -3, 0],
    });
  });

  it("rejects non-integer deltas", () => {
    expect(() => incrementRows("shop_inventory", SITE, { id: "i" }, { available: 1.5 }, undefined, "mysql")).toThrow();
  });

  it("refuses site-wide updates, increments and deletes", () => {
    expect(() => updateRows("shop_orders", SITE, {}, { status: "x" }, "mysql")).toThrow(/column match/);
    expect(() => incrementRows("shop_orders", SITE, { site_id: SITE }, { n: 1 }, undefined, "mysql")).toThrow();
    expect(() => deleteRows("shop_orders", SITE, {}, "mysql")).toThrow(/column match/);
  });

  it("classifies driver errors", () => {
    expect(isDuplicateKeyError({ code: "ER_DUP_ENTRY" })).toBe(true);
    expect(isDuplicateKeyError({ errno: 1062 })).toBe(true);
    expect(isDuplicateKeyError(new Error("other"))).toBe(false);
    expect(isRetryableTransactionError({ code: "40P01" })).toBe(true);
    expect(isRetryableTransactionError({ errno: 1213 })).toBe(true);
    expect(isRetryableTransactionError({ code: "23505" })).toBe(false);
  });
});
