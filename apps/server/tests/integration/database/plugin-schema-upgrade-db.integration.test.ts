// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PluginSchemaTable } from "@justflows/sdk";
import { getDb } from "../../../src/lib/database/db.js";
import { applyPluginSchema } from "../../../src/lib/plugins/plugin-schema.js";

/**
 * Run with a disposable database:
 *   PLUGIN_SCHEMA_TEST_DATABASE=1 DB_NAME=plugin_schema_test DB_DRIVER=postgres|mysql|mariadb \
 *   DB_HOST=… DB_PORT=… DB_USER=… DB_PASSWORD=… \
 *   pnpm vitest run tests/integration/database/plugin-schema-upgrade-db.integration.test.ts
 */
const enabled =
  process.env.PLUGIN_SCHEMA_TEST_DATABASE === "1" && process.env.DB_NAME === "plugin_schema_test";

const v1: PluginSchemaTable[] = [
  {
    name: "orders",
    columns: [
      { name: "id", type: "uuid", primary: true },
      { name: "site_id", type: "uuid", notNull: true },
      { name: "total", type: "bigint", notNull: true },
    ],
    indexes: [{ name: "site", columns: ["site_id"] }],
  },
];

const v2: PluginSchemaTable[] = [
  {
    name: "orders",
    columns: [
      ...v1[0]!.columns,
      { name: "channel", type: "varchar", length: 32, notNull: true },
      { name: "meta", type: "json" },
      { name: "placed_at", type: "timestamptz", notNull: true },
    ],
    indexes: [
      { name: "site", columns: ["site_id"] },
      { name: "channel", columns: ["site_id", "channel"] },
      { name: "ref", columns: ["site_id", "placed_at"], unique: true },
    ],
  },
  {
    name: "notes",
    columns: [
      { name: "id", type: "uuid", primary: true },
      { name: "site_id", type: "uuid", notNull: true },
    ],
  },
];

describe.skipIf(!enabled)("plugin schema upgrades on a real database", () => {
  const apply = (tables: PluginSchemaTable[]) =>
    applyPluginSchema({ pluginId: "justflows.upgrade-probe", tables, allowRemote: false });

  beforeAll(async () => {
    const db = await getDb();
    for (const name of ["upgrade_probe_orders", "upgrade_probe_notes"]) await db.run(`DROP TABLE IF EXISTS ${name}`);
  });

  afterAll(async () => {
    const db = await getDb();
    for (const name of ["upgrade_probe_orders", "upgrade_probe_notes"]) await db.run(`DROP TABLE IF EXISTS ${name}`);
    await db.close();
  });

  it("adds declared columns and indexes to an existing table, keeping its rows", async () => {
    expect(await apply(v1)).toMatchObject({ ok: true });
    const db = await getDb();
    const id = randomUUID();
    await db.run("INSERT INTO upgrade_probe_orders (id, site_id, total) VALUES (?, ?, ?)", [id, randomUUID(), 1200]);

    const upgraded = await apply(v2);
    expect(upgraded.ok).toBe(true);
    expect(upgraded.columnsAdded?.sort()).toEqual([
      "upgrade_probe_orders.channel",
      "upgrade_probe_orders.meta",
      "upgrade_probe_orders.placed_at",
    ]);
    if (process.env.DB_DRIVER !== "postgres") {
      expect(upgraded.indexesAdded?.sort()).toEqual([
        "idx_upgrade_probe_orders_channel",
        "idx_upgrade_probe_orders_ref",
      ]);
    }
    const rows = await db.query<Record<string, unknown>>("SELECT total, channel, placed_at FROM upgrade_probe_orders WHERE id = ?", [id]);
    expect(Number(rows[0]?.total)).toBe(1200);
    expect(rows[0]?.channel).toBeNull();

    // The new unique index is real.
    const at = "2026-10-11 10:00:00";
    const site = randomUUID();
    await db.run("INSERT INTO upgrade_probe_orders (id, site_id, total, channel, placed_at) VALUES (?, ?, 1, 'web', ?)", [randomUUID(), site, at]);
    await expect(
      db.run("INSERT INTO upgrade_probe_orders (id, site_id, total, channel, placed_at) VALUES (?, ?, 1, 'web', ?)", [randomUUID(), site, at]),
    ).rejects.toThrow();

    // A second apply has nothing left to add.
    const again = await apply(v2);
    expect(again).toMatchObject({ ok: true });
    expect(again.columnsAdded).toBeUndefined();
    expect(again.indexesAdded).toBeUndefined();
  });

  it("reports a unique index that existing rows break instead of skipping it", async () => {
    const db = await getDb();
    await db.run("DROP TABLE IF EXISTS upgrade_probe_notes");
    expect(await apply(v1.concat([{ name: "notes", columns: v2[1]!.columns.concat([{ name: "code", type: "int" }]) }]))).toMatchObject({ ok: true });
    await db.run("INSERT INTO upgrade_probe_notes (id, site_id, code) VALUES (?, ?, 7)", [randomUUID(), randomUUID()]);
    await db.run("INSERT INTO upgrade_probe_notes (id, site_id, code) VALUES (?, ?, 7)", [randomUUID(), randomUUID()]);
    const result = await apply(
      v2.slice(0, 1).concat([
        {
          name: "notes",
          columns: v2[1]!.columns.concat([{ name: "code", type: "int" }]),
          indexes: [{ name: "code", columns: ["code"], unique: true }],
        },
      ]),
    );
    expect(result.ok).toBe(false);
  });
});
