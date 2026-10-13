// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from "vitest";
import {
  applyCompiledSchema,
  compileDropPluginTables,
  compilePluginSchema,
  compilePluginSchemaUpgrade,
  readExistingPluginTables,
  isPluginOwnedTable,
  listPluginOwnedTables,
  deletePluginSiteRows,
  pluginOwnedTableLikePattern,
  pluginTablePrefix,
} from "../../../src/lib/plugins/plugin-schema.js";

describe("plugin schema compiler", () => {
  it("prefixes tables with the plugin slug", () => {
    expect(pluginTablePrefix("justflows.shop")).toBe("shop");
    const compiled = compilePluginSchema(
      "justflows.shop",
      [
        {
          name: "products",
          columns: [
            { name: "id", type: "uuid", primary: true },
            { name: "site_id", type: "uuid", notNull: true },
            { name: "title", type: "varchar", length: 255, notNull: true },
          ],
          indexes: [{ name: "site", columns: ["site_id"] }],
        },
      ],
      "mysql",
    );
    expect(compiled[0]?.tableName).toBe("shop_products");
    expect(compiled[0]?.sql[0]).toContain("CREATE TABLE IF NOT EXISTS `shop_products`");
    expect(compiled[0]?.sql[0]).toContain("ENGINE=InnoDB");
    expect(compiled[0]?.sql[0]).toContain("KEY `idx_shop_products_site` (`site_id`)");
    expect(compiled[0]?.sql[0]).not.toMatch(/\busers\b/);
  });

  it("emits postgres types and separate indexes", () => {
    const compiled = compilePluginSchema(
      "justflows.shop",
      [
        {
          name: "orders",
          columns: [
            { name: "id", type: "uuid", primary: true },
            { name: "data", type: "json" },
            { name: "created_at", type: "timestamptz", notNull: true },
          ],
          indexes: [{ name: "created", columns: ["created_at"] }],
        },
      ],
      "postgres",
    );
    expect(compiled[0]?.sql[0]).toContain("JSONB");
    expect(compiled[0]?.sql[0]).toContain("TIMESTAMPTZ");
    expect(compiled[0]?.sql[1]).toBe(
      'CREATE INDEX IF NOT EXISTS "idx_shop_orders_created" ON "shop_orders" ("created_at")',
    );
  });

  it("quotes reserved MariaDB column names such as precision", () => {
    const compiled = compilePluginSchema(
      "justflows.shop",
      [
        {
          name: "stores",
          columns: [
            { name: "id", type: "uuid", primary: true },
            { name: "precision", type: "int", notNull: true },
            { name: "type", type: "varchar", length: 32, notNull: true },
          ],
        },
      ],
      "mysql",
    );
    expect(compiled[0]?.sql[0]).toContain("`precision` INT NOT NULL");
    expect(compiled[0]?.sql[0]).toContain("`type` VARCHAR(32) NOT NULL");
    expect(compiled[0]?.sql[0]).not.toMatch(/(?:^|\s)precision INT/);
  });

  it("emits unique indexes when requested", () => {
    const compiled = compilePluginSchema(
      "justflows.shop",
      [
        {
          name: "stores",
          columns: [
            { name: "id", type: "uuid", primary: true },
            { name: "site_id", type: "uuid", notNull: true },
          ],
          indexes: [{ name: "site", columns: ["site_id"], unique: true }],
        },
      ],
      "mysql",
    );
    expect(compiled[0]?.sql[0]).toContain("UNIQUE KEY `idx_shop_stores_site` (`site_id`)");
  });

  it("drops only plugin-prefixed tables and ignores core names", () => {
    expect(isPluginOwnedTable("justflows.shop", "shop_products")).toBe(true);
    expect(isPluginOwnedTable("justflows.shop", "users")).toBe(false);
    expect(isPluginOwnedTable("justflows.shop", "shopping_cart")).toBe(false);
    expect(pluginOwnedTableLikePattern("justflows.shop")).toBe("shop!_%");

    const mysql = compileDropPluginTables(
      "justflows.shop",
      ["shop_products", "users", "shop_orders"],
      "mysql",
    );
    expect(mysql[0]).toBe("SET FOREIGN_KEY_CHECKS=0");
    expect(mysql).toContain("DROP TABLE IF EXISTS `shop_products`");
    expect(mysql).toContain("DROP TABLE IF EXISTS `shop_orders`");
    expect(mysql.join("\n")).not.toMatch(/users/);
    expect(mysql.at(-1)).toBe("SET FOREIGN_KEY_CHECKS=1");

    const postgres = compileDropPluginTables("justflows.shop", ["shop_products"], "postgres");
    expect(postgres[0]).toBe('DROP TABLE IF EXISTS "shop_products" CASCADE');
    expect(compileDropPluginTables("justflows.shop", ["users"], "mysql")).toEqual([]);
  });

  it("lists only owned tables from information_schema rows", async () => {
    const query = vi.fn().mockResolvedValue([
      { table_name: "shop_products" },
      { table_name: "users" },
      { TABLE_NAME: "shop_orders" },
    ]);
    const tables = await listPluginOwnedTables({ query }, "justflows.shop", "mysql");
    expect(tables).toEqual(["shop_products", "shop_orders"]);
    expect(query.mock.calls[0]?.[1]).toEqual(["shop!_%"]);
  });

  it("reads table names from Buffer column values", async () => {
    const query = vi.fn().mockResolvedValue([{ table_name: Buffer.from("shop_carts") }]);
    const tables = await listPluginOwnedTables({ query }, "justflows.shop", "mysql");
    expect(tables).toEqual(["shop_carts"]);
  });

  it("parameterizes the MariaDB SHOW TABLES fallback pattern", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ table_name: "hello_world_entries" }]);

    const tables = await listPluginOwnedTables({ query }, "justflows.hello-world", "mariadb");

    expect(tables).toEqual(["hello_world_entries"]);
    expect(query).toHaveBeenNthCalledWith(2, "SHOW TABLES LIKE ?", ["hello\\_world\\_%"]);
  });

  it("rejects identifiers that could escape the plugin prefix", () => {
    expect(() =>
      compilePluginSchema(
        "justflows.shop",
        [{ name: "products; drop table users", columns: [{ name: "id", type: "uuid", primary: true }] }],
        "mysql",
      ),
    ).toThrow(/Invalid table/);
  });
});

describe("plugin schema upgrades", () => {
  const orders = {
    name: "orders",
    columns: [
      { name: "id", type: "uuid" as const, primary: true },
      { name: "site_id", type: "uuid" as const, notNull: true },
      { name: "channel", type: "varchar" as const, length: 32, notNull: true, unique: true },
      { name: "total", type: "bigint" as const, notNull: true },
    ],
    indexes: [
      { name: "site", columns: ["site_id"] },
      { name: "channel", columns: ["site_id", "channel"], unique: true },
    ],
  };
  const existing = new Map([
    ["shop_orders", { columns: new Set(["id", "site_id", "total"]), indexes: new Set(["PRIMARY", "idx_shop_orders_site"]) }],
  ]);

  it("adds a missing column as nullable and not unique, and its missing index", () => {
    const [upgrade] = compilePluginSchemaUpgrade("justflows.shop", [orders], "mysql", existing);
    expect(upgrade?.columns).toEqual(["ALTER TABLE `shop_orders` ADD COLUMN `channel` VARCHAR(32)"]);
    expect(upgrade?.indexes).toEqual([
      "CREATE UNIQUE INDEX `idx_shop_orders_channel` ON `shop_orders` (`site_id`, `channel`)",
    ]);
    expect(upgrade?.columnNames).toEqual(["channel"]);
  });

  it("leaves postgres indexes to CREATE INDEX IF NOT EXISTS", () => {
    const [upgrade] = compilePluginSchemaUpgrade("justflows.shop", [orders], "postgres", existing);
    expect(upgrade?.columns).toEqual(['ALTER TABLE "shop_orders" ADD COLUMN "channel" VARCHAR(32)']);
    expect(upgrade?.indexes).toEqual([]);
  });

  it("does nothing for new or complete tables and refuses a missing primary key", () => {
    expect(compilePluginSchemaUpgrade("justflows.shop", [orders], "mysql", new Map())).toEqual([]);
    const complete = new Map([
      ["shop_orders", {
        columns: new Set(["id", "site_id", "channel", "total"]),
        indexes: new Set(["idx_shop_orders_site", "idx_shop_orders_channel"]),
      }],
    ]);
    expect(compilePluginSchemaUpgrade("justflows.shop", [orders], "mysql", complete)).toEqual([]);
    const noKey = new Map([["shop_orders", { columns: new Set(["site_id"]), indexes: new Set<string>() }]]);
    expect(() => compilePluginSchemaUpgrade("justflows.shop", [orders], "mysql", noKey)).toThrow(/primary key/);
  });

  it("reads existing columns and indexes of owned tables only", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        { TABLE_NAME: "shop_orders", COLUMN_NAME: "id" },
        { table_name: Buffer.from("shop_orders"), column_name: "total" },
        { table_name: "users", column_name: "id" },
      ])
      .mockResolvedValueOnce([{ TABLE_NAME: "shop_orders", INDEX_NAME: "idx_shop_orders_site" }]);
    const found = await readExistingPluginTables({ query }, "justflows.shop", "mysql");
    expect([...found.keys()]).toEqual(["shop_orders"]);
    expect([...(found.get("shop_orders")?.columns ?? [])]).toEqual(["id", "total"]);
    expect([...(found.get("shop_orders")?.indexes ?? [])]).toEqual(["idx_shop_orders_site"]);
    expect(query.mock.calls.every((call) => call[1]?.[0] === "shop!_%")).toBe(true);
  });

  it("adds columns before indexes and fails on duplicate data under a new unique index", async () => {
    const compiled = compilePluginSchema("justflows.shop", [orders], "postgres");
    const upgrades = compilePluginSchemaUpgrade("justflows.shop", [orders], "postgres", existing);
    const run = vi.fn().mockResolvedValue(undefined);
    await applyCompiledSchema({ run }, compiled, upgrades);
    const statements = run.mock.calls.map((call) => String(call[0]));
    expect(statements[0]).toContain("CREATE TABLE IF NOT EXISTS");
    expect(statements[1]).toContain("ADD COLUMN");
    expect(statements.slice(2).every((sql) => sql.startsWith("CREATE"))).toBe(true);

    const mysqlUpgrades = compilePluginSchemaUpgrade("justflows.shop", [orders], "mysql", existing);
    const failing = vi.fn(async (sql: string) => {
      if (sql.startsWith("CREATE UNIQUE INDEX")) throw new Error("Duplicate entry 'web' for key");
      if (sql.includes("ADD COLUMN")) throw new Error("Duplicate column name 'channel'");
    });
    await expect(
      applyCompiledSchema({ run: failing }, compilePluginSchema("justflows.shop", [orders], "mysql"), mysqlUpgrades),
    ).rejects.toThrow(/Duplicate entry/);
  });
});

describe("required workspace plugin cleanup", () => {
  it("does not hide a failed table discovery during permanent removal", async () => {
    const db = { query: vi.fn().mockRejectedValue(new Error("metadata unavailable")), run: vi.fn() };
    await expect(deletePluginSiteRows(db, "justflows.shop", "site", "postgres", [], true)).rejects.toThrow("metadata unavailable");
    expect(db.run).not.toHaveBeenCalled();
  });
  it("does not mistake a failed column check for a table without site ownership", async () => {
    const db = { query: vi.fn().mockResolvedValueOnce([{ table_name: "shop_orders" }]).mockRejectedValueOnce(new Error("column metadata unavailable")), run: vi.fn() };
    await expect(deletePluginSiteRows(db, "justflows.shop", "site", "postgres", [], true)).rejects.toThrow("column metadata unavailable");
    expect(db.run).not.toHaveBeenCalled();
  });
});
