// SPDX-License-Identifier: MIT

import { AsyncLocalStorage } from "node:async_hooks";
import type {
  PluginDatabasesApi,
  PluginDatabaseDriver,
  PluginDatabaseTarget,
  PluginPermission,
  PluginRowOps,
  PluginSchemaTable,
} from "@justflows/sdk";
import type { DbClient } from "../database/db.js";

import { isLocalDatabaseHost, probeDatabase, probeSharedDatabase } from "../database/db-probe.js";
import {
  applyPluginSchema,
  deletePluginSiteRows,
  dropPluginSchema,
  isPluginOwnedTable,
  listPluginOwnedTables,
  openTargetDatabase,
  pluginTableName,
} from "./plugin-schema.js";
import { mayDropPluginTables, otherSitesHavePlugin } from "./plugin-multisite.js";
import { pluginCallSiteId } from "./request-site.js";
import {
  PLUGIN_HOST_SCHEMA_ITEM,
  PLUGIN_HOST_SCHEMA_PASSWORD_ITEM,
  getPluginHostItem,
} from "./plugin-kv.js";
import { decryptSecret } from "../security/secret-box.js";
import { getSiteId } from "../settings/site-settings.js";
import { recordAppliedPluginSchema, type AppliedPluginSchemaMeta } from "./plugin-purge.js";
import {
  deleteRows,
  incrementRows,
  insertRow,
  isDuplicateKeyError,
  isRetryableTransactionError,
  quoteIdent,
  selectRows,
  updateRows,
} from "./plugin-row-sql.js";

const IDENT = /^[a-z][a-z0-9_]{0,47}$/;
const TRANSACTION_ATTEMPTS = 3;

type Scalar = string | number | boolean | null;
type Executor = Pick<DbClient, "run" | "query" | "execute">;
type RowHandle = { db: Executor; driver: PluginDatabaseDriver; inTransaction: boolean };

/** The open transaction for one plugin on one site, joined by row calls made inside it. */
const activeTransaction = new AsyncLocalStorage<{ pluginId: string; siteId: string; handle: RowHandle }>();

function ownedTable(pluginId: string, table: string): string {
  const tableName = pluginTableName(pluginId, table);
  if (!isPluginOwnedTable(pluginId, tableName)) {
    throw new Error(`Plugin "${pluginId}" cannot query table "${table}"`);
  }
  return tableName;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return value.toString("utf8");
  return String(value ?? "");
}

async function recordedTarget(
  pluginId: string,
  siteId: string,
): Promise<{ target?: PluginDatabaseTarget; tables?: string[] }> {
  const meta = await getPluginHostItem<AppliedPluginSchemaMeta>(
    pluginId,
    siteId,
    PLUGIN_HOST_SCHEMA_ITEM,
  );
  if (!meta?.target) return { tables: meta?.tables };
  const stored = await getPluginHostItem<string>(pluginId, siteId, PLUGIN_HOST_SCHEMA_PASSWORD_ITEM);
  return {
    tables: meta.tables,
    target: { ...meta.target, password: decryptSecret(stored ?? "") },
  };
}

async function openHandle(
  pluginId: string,
  siteId: string,
  permissions: ReadonlySet<PluginPermission> | ReadonlySet<string>,
): Promise<{ db: DbClient; close: boolean; driver: PluginDatabaseDriver }> {
  const recorded = await recordedTarget(pluginId, siteId);
  if (recorded.target) {
    if (!isLocalDatabaseHost(recorded.target.host) && !permissions.has("network:outbound")) {
      throw new Error(
        `Plugin "${pluginId}" cannot use a remote database without the "network:outbound" permission.`,
      );
    }
    return {
      db: await openTargetDatabase(recorded.target),
      close: true,
      driver: recorded.target.driver,
    };
  }
  const { getDb } = await import("../database/db.js");
  return {
    db: await getDb(),
    close: false,
    driver: (process.env.DB_DRIVER as PluginDatabaseDriver | undefined) || "mysql",
  };
}

async function applySchemaRemoval(
  pluginId: string,
  siteId: string,
  permissions: ReadonlySet<PluginPermission> | ReadonlySet<string>,
  tables: PluginSchemaTable[] | undefined,
  options: { target?: PluginDatabaseTarget } | undefined,
  allowDrop: boolean,
): Promise<{ ok: boolean; tables: string[]; error?: string }> {
  let target = options?.target;
  let knownTables: string[] | undefined;
  try {
    if (siteId) {
      const recorded = await recordedTarget(pluginId, siteId);
      knownTables = recorded.tables;
      if (!target && recorded.target) target = recorded.target;
    }
  } catch {
    // Plugin-supplied arguments are enough when host metadata is missing.
  }

  const { isInstallationRootSite } = await import("../tenancy/registry.js");
  const root = siteId ? await isInstallationRootSite(siteId) : true;
  const others = siteId ? await otherSitesHavePlugin(pluginId, siteId) : false;
  const drop = allowDrop && mayDropPluginTables({ installationRoot: root, otherSitesUsePlugin: others });
  if (drop) {
    return dropPluginSchema({
      pluginId,
      ...(tables ? { tables } : {}),
      ...(target ? { target } : {}),
      ...(knownTables ? { knownTables } : {}),
      allowRemote: permissions.has("network:outbound"),
    });
  }

  const driver: PluginDatabaseDriver = target?.driver
    ?? ((process.env.DB_DRIVER as PluginDatabaseDriver | undefined) || "mysql");
  let db: DbClient | undefined;
  let close = false;
  try {
    const known = tables?.length
      ? tables.map((table) => pluginTableName(pluginId, table.name))
      : (knownTables ?? []);
    if (target) {
      if (!isLocalDatabaseHost(target.host) && !permissions.has("network:outbound")) {
        return {
          ok: false,
          tables: [],
          error: `Plugin "${pluginId}" cannot change a remote database without the "network:outbound" permission.`,
        };
      }
      db = await openTargetDatabase(target);
      close = true;
    } else {
      const { getDb } = await import("../database/db.js");
      db = await getDb();
    }
    const cleared = await deletePluginSiteRows(db, pluginId, siteId, driver, known);
    return { ok: true, tables: cleared };
  } catch (err) {
    const { sanitizeProbeError } = await import("../database/db-probe.js");
    return { ok: false, tables: [], error: sanitizeProbeError(err) };
  } finally {
    if (close) await db?.close();
  }
}

export function createPluginDatabasesApi(
  pluginId: string,
  siteId: string,
  permissions: ReadonlySet<PluginPermission> | ReadonlySet<string>,
): PluginDatabasesApi {
  /** Run on the open transaction for this plugin and site, or on a fresh handle. */
  async function withRows<T>(sid: string, fn: (handle: RowHandle) => Promise<T>): Promise<T> {
    const open = activeTransaction.getStore();
    if (open && open.pluginId === pluginId && open.siteId === sid) return fn(open.handle);
    const handle = await openHandle(pluginId, sid, permissions);
    try {
      return await fn({ db: handle.db, driver: handle.driver, inTransaction: false });
    } finally {
      if (handle.close) await handle.db.close();
    }
  }

  async function deleteMatching(table: string, where: Record<string, Scalar>): Promise<number> {
    const sid = pluginCallSiteId(siteId);
    const tableName = ownedTable(pluginId, table);
    return withRows(sid, async (handle) => {
      const statement = deleteRows(tableName, sid, where, handle.driver);
      return handle.db.execute(statement.sql, statement.params);
    });
  }

  const api: PluginDatabasesApi = {
    probeShared: () => probeSharedDatabase(),
    async probe(target: PluginDatabaseTarget) {
      if (!isLocalDatabaseHost(target.host) && !permissions.has("network:outbound")) {
        return {
          ok: false,
          error: `Plugin "${pluginId}" cannot probe a remote database without the "network:outbound" permission.`,
          dialect: target.driver,
          tls: Boolean(target.ssl),
          latencyMs: 0,
        };
      }
      return probeDatabase(target);
    },
    async ensureSchema(tables: PluginSchemaTable[], options?: { target?: PluginDatabaseTarget; rebuild?: string[] }) {
      const sid = pluginCallSiteId(siteId);
      const { isInstallationRootSite } = await import("../tenancy/registry.js");
      const root = await isInstallationRootSite(sid);
      if (!root && !options?.target) {
        if (options?.rebuild?.length) {
          return { ok: false, tables: [], error: "Only the main site can change this plugin's tables." };
        }
        const driver = (process.env.DB_DRIVER as PluginDatabaseDriver | undefined) || "mysql";
        const { getDb } = await import("../database/db.js");
        const existing = await listPluginOwnedTables(await getDb(), pluginId, driver);
        if (existing.length === 0) {
          return {
            ok: false,
            tables: [],
            error: "The main site has to set up this plugin before another site can use it.",
          };
        }
        return { ok: true, tables: existing };
      }
      const rebuild = root ? options?.rebuild : undefined;
      const result = await applyPluginSchema({
        pluginId,
        tables,
        ...(options?.target ? { target: options.target } : {}),
        ...(rebuild?.length ? { rebuild } : {}),
        allowRemote: permissions.has("network:outbound"),
      });
      if (result.ok && root && !options?.target) {
        const { runOnSeparateDatabases } = await import("../tenancy/connections.js");
        const others = await runOnSeparateDatabases(() =>
          applyPluginSchema({
            pluginId,
            tables,
            allowRemote: permissions.has("network:outbound"),
          }),
        );
        const failed = others.find((item) => !item.ok);
        if (failed) return failed;
      }
      if (result.ok) {
        try {
          await recordAppliedPluginSchema(pluginId, result.tables, options?.target);
        } catch {
          // Tables exist; remembering the target must not fail activation.
        }
      }
      return result;
    },
    async dropSchema(tables?: PluginSchemaTable[], options?: { target?: PluginDatabaseTarget }) {
      const sid = pluginCallSiteId(siteId) || (await getSiteId()) || "";
      return applySchemaRemoval(pluginId, sid, permissions, tables, options, true);
    },
    async clear(tables?: PluginSchemaTable[]) {
      const sid = pluginCallSiteId(siteId) || (await getSiteId()) || "";
      return applySchemaRemoval(pluginId, sid, permissions, tables, undefined, false);
    },
    async upsert(table, row, options) {
      const sid = pluginCallSiteId(siteId);
      const tableName = ownedTable(pluginId, table);
      const match = (options?.match?.length ? options.match : ["id"]).filter((col) => IDENT.test(col));
      const payload: Record<string, Scalar> = { ...row, site_id: sid };
      const columns = Object.keys(payload).filter((col) => IDENT.test(col));
      if (columns.length === 0) return;
      await withRows(sid, async (handle) => {
        const whereCols = match.filter((col) => payload[col] !== undefined && payload[col] !== null);
        let existingId: string | undefined;
        if (whereCols.length > 0) {
          const clause = whereCols.map((col) => `${quoteIdent(col, handle.driver)} = ?`).join(" AND ");
          const rows = await handle.db.query<{ id: string }>(
            `SELECT id FROM ${quoteIdent(tableName, handle.driver)} WHERE ${quoteIdent("site_id", handle.driver)} = ? AND ${clause} LIMIT 1`,
            [sid, ...whereCols.map((col) => payload[col] ?? null)],
          );
          existingId = rows[0]?.id ? asString(rows[0].id) : undefined;
        } else {
          const rows = await handle.db.query<{ id: string }>(
            `SELECT id FROM ${quoteIdent(tableName, handle.driver)} WHERE ${quoteIdent("site_id", handle.driver)} = ? LIMIT 1`,
            [sid],
          );
          existingId = rows[0]?.id ? asString(rows[0].id) : undefined;
        }
        if (existingId) {
          const updates = columns.filter((col) => col !== "id" && col !== "site_id");
          if (updates.length === 0) return;
          await handle.db.run(
            `UPDATE ${quoteIdent(tableName, handle.driver)} SET ${updates.map((col) => `${quoteIdent(col, handle.driver)} = ?`).join(", ")} WHERE ${quoteIdent("site_id", handle.driver)} = ? AND ${quoteIdent("id", handle.driver)} = ?`,
            [...updates.map((col) => payload[col] ?? null), sid, existingId],
          );
          return;
        }
        await handle.db.run(
          `INSERT INTO ${quoteIdent(tableName, handle.driver)} (${columns.map((col) => quoteIdent(col, handle.driver)).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
          columns.map((col) => payload[col] ?? null),
        );
      });
    },
    async findOne(table, where = {}, options) {
      const sid = pluginCallSiteId(siteId);
      const tableName = ownedTable(pluginId, table);
      return withRows(sid, async (handle) => {
        const statement = selectRows(tableName, sid, where, { ...options, limit: 1 }, handle.driver);
        try {
          const rows = await handle.db.query<Record<string, unknown>>(statement.sql, statement.params);
          return rows[0];
        } catch (err) {
          if (handle.inTransaction) throw err;
          return undefined;
        }
      });
    },
    async find(table, where = {}, options) {
      const sid = pluginCallSiteId(siteId);
      const tableName = ownedTable(pluginId, table);
      return withRows(sid, async (handle) => {
        try {
          const statement = selectRows(tableName, sid, where, options, handle.driver);
          return await handle.db.query<Record<string, unknown>>(statement.sql, statement.params);
        } catch (err) {
          if (handle.inTransaction) throw err;
          return [];
        }
      });
    },
    async delete(table, where) {
      await deleteMatching(table, where);
    },
    async insert(table, row) {
      const sid = pluginCallSiteId(siteId);
      const tableName = ownedTable(pluginId, table);
      return withRows(sid, async (handle) => {
        const statement = insertRow(tableName, sid, row, handle.driver);
        try {
          return (await handle.db.execute(statement.sql, statement.params)) > 0;
        } catch (err) {
          if (isDuplicateKeyError(err)) return false;
          throw err;
        }
      });
    },
    async update(table, where, values) {
      const sid = pluginCallSiteId(siteId);
      const tableName = ownedTable(pluginId, table);
      return withRows(sid, async (handle) => {
        const statement = updateRows(tableName, sid, where, values, handle.driver);
        if (!statement) return 0;
        return handle.db.execute(statement.sql, statement.params);
      });
    },
    async increment(table, where, deltas, options) {
      const sid = pluginCallSiteId(siteId);
      const tableName = ownedTable(pluginId, table);
      return withRows(sid, async (handle) => {
        const statement = incrementRows(tableName, sid, where, deltas, options, handle.driver);
        if (!statement) return 0;
        return handle.db.execute(statement.sql, statement.params);
      });
    },
    async transaction(fn) {
      const sid = pluginCallSiteId(siteId);
      const open = activeTransaction.getStore();
      if (open && open.pluginId === pluginId && open.siteId === sid) return fn(rowOps);
      for (let attempt = 1; ; attempt += 1) {
        const handle = await openHandle(pluginId, sid, permissions);
        try {
          return await handle.db.transaction((tx) =>
            activeTransaction.run(
              { pluginId, siteId: sid, handle: { db: tx, driver: handle.driver, inTransaction: true } },
              () => fn(rowOps),
            ),
          );
        } catch (err) {
          if (attempt >= TRANSACTION_ATTEMPTS || !isRetryableTransactionError(err)) throw err;
        } finally {
          if (handle.close) await handle.db.close();
        }
      }
    },
    async columns(table) {
      const sid = pluginCallSiteId(siteId);
      const tableName = ownedTable(pluginId, table);
      const handle = await openHandle(pluginId, sid, permissions);
      try {
        if (handle.driver === "postgres") {
          const rows = await handle.db.query<{ column_name: string }>(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position",
            [tableName],
          );
          return rows.map((row) => asString(row.column_name));
        }
        const rows = await handle.db.query<{ Field: string; field?: string }>(
          `SHOW COLUMNS FROM ${quoteIdent(tableName, handle.driver)}`,
        );
        return rows.map((row) => asString(row.Field ?? row.field ?? ""));
      } catch {
        return [];
      } finally {
        if (handle.close) await handle.db.close();
      }
    },
  };
  const rowOps: PluginRowOps = {
    findOne: (table, where, options) => api.findOne(table, where, options),
    find: (table, where, options) => api.find(table, where, options),
    insert: (table, row) => api.insert(table, row),
    upsert: (table, row, options) => api.upsert(table, row, options),
    update: (table, where, values) => api.update(table, where, values),
    increment: (table, where, deltas, options) => api.increment(table, where, deltas, options),
    delete: (table, where) => deleteMatching(table, where),
  };
  return api;
}
