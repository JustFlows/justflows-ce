// SPDX-License-Identifier: MIT

import type {
  PluginDatabasesApi,
  PluginDatabaseDriver,
  PluginDatabaseTarget,
  PluginPermission,
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

const IDENT = /^[a-z][a-z0-9_]{0,47}$/;

type Scalar = string | number | boolean | null;

function quoteIdent(value: string, driver: PluginDatabaseDriver): string {
  if (!IDENT.test(value)) {
    throw new Error(`Invalid identifier "${value}"`);
  }
  return driver === "postgres" ? `"${value}"` : `\`${value}\``;
}

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
  return {
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
      const handle = await openHandle(pluginId, sid, permissions);
      const match = (options?.match?.length ? options.match : ["id"]).filter((col) => IDENT.test(col));
      const payload: Record<string, Scalar> = { ...row, site_id: sid };
      const columns = Object.keys(payload).filter((col) => IDENT.test(col));
      if (columns.length === 0) return;
      try {
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
      } finally {
        if (handle.close) await handle.db.close();
      }
    },
    async findOne(table, where = {}) {
      const sid = pluginCallSiteId(siteId);
      const tableName = ownedTable(pluginId, table);
      const handle = await openHandle(pluginId, sid, permissions);
      const filters = Object.entries(where).filter(([col]) => IDENT.test(col));
      try {
        const clause = [
          `${quoteIdent("site_id", handle.driver)} = ?`,
          ...filters.map(([col]) => `${quoteIdent(col, handle.driver)} = ?`),
        ].join(" AND ");
        const rows = await handle.db.query<Record<string, unknown>>(
          `SELECT * FROM ${quoteIdent(tableName, handle.driver)} WHERE ${clause} LIMIT 1`,
          [sid, ...filters.map(([, value]) => value)],
        );
        return rows[0];
      } catch {
        return undefined;
      } finally {
        if (handle.close) await handle.db.close();
      }
    },
    async find(table, where = {}, options) {
      const sid = pluginCallSiteId(siteId);
      const tableName = ownedTable(pluginId, table);
      const handle = await openHandle(pluginId, sid, permissions);
      const filters = Object.entries(where).filter(([col]) => IDENT.test(col));
      const limit = Math.min(Math.max(1, Math.trunc(options?.limit ?? 100)), 500);
      try {
        const clause = [
          `${quoteIdent("site_id", handle.driver)} = ?`,
          ...filters.map(([col]) => `${quoteIdent(col, handle.driver)} = ?`),
        ].join(" AND ");
        return await handle.db.query<Record<string, unknown>>(
          `SELECT * FROM ${quoteIdent(tableName, handle.driver)} WHERE ${clause} LIMIT ?`,
          [sid, ...filters.map(([, value]) => value), limit],
        );
      } catch {
        return [];
      } finally {
        if (handle.close) await handle.db.close();
      }
    },
    async delete(table, where) {
      const sid = pluginCallSiteId(siteId);
      const tableName = ownedTable(pluginId, table);
      const filters = Object.entries(where).filter(([col]) => IDENT.test(col));
      if (filters.length === 0) {
        throw new Error(`Plugin "${pluginId}" cannot delete from "${table}" without a column match`);
      }
      const handle = await openHandle(pluginId, sid, permissions);
      try {
        const clause = [
          `${quoteIdent("site_id", handle.driver)} = ?`,
          ...filters.map(([col]) => `${quoteIdent(col, handle.driver)} = ?`),
        ].join(" AND ");
        await handle.db.run(
          `DELETE FROM ${quoteIdent(tableName, handle.driver)} WHERE ${clause}`,
          [sid, ...filters.map(([, value]) => value)],
        );
      } finally {
        if (handle.close) await handle.db.close();
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
}
