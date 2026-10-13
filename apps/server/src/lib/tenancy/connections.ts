// SPDX-License-Identifier: MIT

import { isMissingTableError } from "../database/schema-errors.js";
import {
  createDbClient,
  getControlDb,
  runWithDatabase,
  type DbClient,
  type DbConnectionConfig,
} from "../database/db.js";
import { decryptSecret } from "../security/secret-box.js";
import { effectiveDatabaseMode } from "./choice.js";
import type { DatabaseChoice, DatabaseMode } from "./context.js";

export interface SeparateDatabaseRow {
  id: string;
  tenant_id: string;
  site_id: string | null;
  mode: string;
  status: string;
  driver: string | null;
  host: string | null;
  port: number | null;
  database_name: string | null;
  username: string | null;
  password_ciphertext: string | null;
  updated_at: string;
}

const pools = new Map<string, DbClient>();

export function databaseConfigFromRow(row: SeparateDatabaseRow): DbConnectionConfig | null {
  if (row.mode !== "separate" || row.status !== "ready") return null;
  if (!row.host || !row.database_name || !row.username || !row.driver) return null;
  const driver = row.driver === "postgres" || row.driver === "mysql" || row.driver === "mariadb" ? row.driver : null;
  if (!driver) return null;
  return {
    driver,
    host: row.host,
    port: String(row.port ?? (driver === "postgres" ? 5432 : 3306)),
    database: row.database_name,
    username: row.username,
    password: decryptSecret(row.password_ciphertext ?? ""),
  };
}

/** Drop a cached connection so the next use opens one with the saved credentials. */
export async function dropSeparateDatabasePool(databaseId: string): Promise<void> {
  const prefix = `${databaseId}:`;
  for (const [key, client] of [...pools.entries()]) {
    if (!key.startsWith(prefix)) continue;
    pools.delete(key);
    await client.close().catch(() => undefined);
  }
}

export async function borrowSeparateDatabase(row: SeparateDatabaseRow): Promise<DbClient | null> {
  const config = databaseConfigFromRow(row);
  if (!config) return null;
  const key = `${row.id}:${row.updated_at}`;
  const cached = pools.get(key);
  if (cached) return cached;
  const client = await createDbClient(config);
  pools.set(key, client);
  return client;
}

export async function separateDatabaseForSite(tenantId: string, siteId: string, choice: DatabaseChoice, tenantMode: DatabaseMode): Promise<SeparateDatabaseRow | null> {
  if (effectiveDatabaseMode(tenantMode, choice) !== "separate") return null;
  const db = await getControlDb();
  const rows = await db.query<SeparateDatabaseRow>(
    `SELECT id, tenant_id, site_id, mode, status, driver, host, port, database_name, username,
            password_ciphertext, updated_at
     FROM tenant_databases
     WHERE tenant_id = ? AND status = 'ready' AND mode = 'separate'
       AND (site_id = ? OR site_id IS NULL)
     ORDER BY CASE WHEN site_id IS NULL THEN 1 ELSE 0 END`,
    [tenantId, siteId],
  );
  if (choice === "separate") return rows.find((row) => row.site_id === siteId) ?? null;
  return rows.find((row) => row.site_id === null) ?? rows[0] ?? null;
}

async function readySeparateDatabases(): Promise<SeparateDatabaseRow[]> {
  try {
    const db = await getControlDb();
    return await db.query<SeparateDatabaseRow>(
      `SELECT id, tenant_id, site_id, mode, status, driver, host, port, database_name, username,
              password_ciphertext, updated_at
       FROM tenant_databases
       WHERE mode = 'separate' AND status = 'ready'`,
    );
  } catch {
    return [];
  }
}

/** Run on every ready separate database. The same database is opened once. */
export async function runOnSeparateDatabases<T>(fn: () => Promise<T>): Promise<T[]> {
  const results: T[] = [];
  const seen = new Set<string>();
  for (const row of await readySeparateDatabases()) {
    const key = `${row.host}:${row.port}:${row.database_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const client = await borrowSeparateDatabase(row);
      if (!client) continue;
      results.push(await runWithDatabase(client, fn));
    } catch (err) {
      console.error(
        "[justflows] tenant database job failed:",
        JSON.stringify(err instanceof Error ? err.message.replace(/[\r\n]/g, " ") : "failed"),
      );
    }
  }
  return results;
}

/**
 * Like runAcrossDatabases, but any database that cannot be reached or
 * queried makes the whole call throw. For checks whose answer must cover
 * every site, such as "is anything still using this file?".
 */
export async function runAcrossDatabasesStrict<T>(fn: () => Promise<T>): Promise<T[]> {
  const results: T[] = [await fn()];
  const seen = new Set<string>();
  const db = await getControlDb();
  const rows = await db.query<SeparateDatabaseRow>(
    `SELECT id, tenant_id, site_id, mode, status, driver, host, port, database_name, username,
            password_ciphertext, updated_at
     FROM tenant_databases
     WHERE mode = 'separate' AND status = 'ready'`,
  ).catch((error: unknown) => {
    // An install without the tenancy tables has no other databases.
    if (isMissingTableError(error)) return [] as SeparateDatabaseRow[];
    throw error;
  });
  for (const row of rows) {
    const key = `${row.host}:${row.port}:${row.database_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const client = await borrowSeparateDatabase(row);
    if (!client) throw new Error("A site database could not be opened");
    results.push(await runWithDatabase(client, fn));
  }
  return results;
}

/** Run once on the installation database and once on every ready separate database. */
export async function runAcrossDatabases<T>(fn: () => Promise<T>): Promise<T[]> {
  return [await fn(), ...(await runOnSeparateDatabases(fn))];
}

/** Run `fn` on every active site, in its database; `options.siteId` limits it to that one site. */
export async function eachActiveSite(fn: (siteId: string) => Promise<void>, options: { siteId?: string } = {}): Promise<void> {
  let sites: Array<{ id: string; tenant_id: string; database_choice: string; database_mode: string }> = [];
  let registry = false;
  try {
    const db = await getControlDb();
    const only = options.siteId ? " AND s.id = ?" : "";
    sites = await db.query(
      `SELECT s.id, s.tenant_id, s.database_choice, t.database_mode
       FROM sites s JOIN tenants t ON t.id = s.tenant_id
       WHERE s.status = 'active' AND t.status = 'active'${only}`,
      options.siteId ? [options.siteId] : [],
    );
    registry = true;
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
    sites = [];
  }
  if (sites.length === 0) {
    // No site registry (single-site install): the one site, when it is the one asked for.
    if (registry) {
      const total = await (await getControlDb()).query("SELECT id FROM sites LIMIT 1");
      if (total.length > 0) return;
    }
    const { getSiteId } = await import("../settings/site-settings.js");
    const siteId = await getSiteId();
    if (siteId && (!options.siteId || options.siteId === siteId)) await fn(siteId);
    return;
  }
  for (const site of sites) {
    try {
      const choice = site.database_choice === "current" || site.database_choice === "separate" ? site.database_choice : "inherit";
      const mode = site.database_mode === "separate" ? "separate" : "current";
      const row = await separateDatabaseForSite(site.tenant_id, site.id, choice, mode);
      if (!row) {
        await fn(site.id);
        continue;
      }
      const client = await borrowSeparateDatabase(row);
      if (!client) continue;
      await runWithDatabase(client, () => fn(site.id));
    } catch (err) {
      console.error(
        "[justflows] site job failed:",
        JSON.stringify(err instanceof Error ? err.message.replace(/[\r\n]/g, " ") : "failed"),
      );
    }
  }
}

/** Bounded activity checks against the authoritative registry, even in a content DB. */
export async function activeSiteIds(siteIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(siteIds)];
  const active = new Set<string>();
  if (ids.length === 0) return active;
  const db = await getControlDb();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    try {
      const rows = await db.query<{ id: string }>(
        `SELECT s.id FROM sites s JOIN tenants t ON t.id = s.tenant_id WHERE s.status = 'active' AND t.status = 'active' AND s.id IN (${batch.map(() => "?").join(", ")})`, batch,
      );
      for (const row of rows) active.add(String(row.id));
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
      // Pre-tenancy installations only have their local site.
      for (const id of batch) active.add(id);
    }
  }
  return active;
}
