// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createDbClient, getControlDb, type DbClient } from "../database/db.js";
import { getUploadStore } from "../media/upload-store.js";
import { cacheStorageDir } from "../cache/jf-cache.js";
import { getJfRoot, uploadsDir } from "../runtime/jf-root.js";
import { decryptSecret } from "../security/secret-box.js";
import { quoteDatabaseIdent } from "./choice.js";
import { hostnameFromUrl } from "./host.js";

export interface PurgeResult {
  ok: true;
  tenantId: string;
}

export interface PurgeFailure {
  ok: false;
  status: number;
  error: string;
}

interface TenantRow {
  id: string;
  slug: string;
  status: string;
  updated_at: string | Date;
}

interface SiteRow {
  id: string;
  url: string;
  database_choice: string;
}

interface DatabaseRow {
  host: string;
  port: number;
  database_name: string;
  username: string;
  password_ciphertext: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function driver(): "postgres" | "mysql" | "mariadb" {
  const value = process.env.DB_DRIVER;
  if (value === "postgres" || value === "mysql" || value === "mariadb") return value;
  throw new Error("DB_DRIVER not set");
}

function stamp(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function installationDatabase(host: string, database: string): boolean {
  const name = process.env.DB_NAME ?? "";
  const configured = (process.env.DB_HOST ?? "127.0.0.1").toLowerCase();
  const candidate = host.toLowerCase();
  const sameHost = candidate === configured || (["localhost", "127.0.0.1", "::1"].includes(candidate) && ["localhost", "127.0.0.1", "::1"].includes(configured));
  return Boolean(name) && database === name && sameHost;
}

async function removeSiteFiles(siteId: string, hostnames: string[]): Promise<void> {
  if (!UUID.test(siteId)) return;
  const folders = [
    path.join(uploadsDir(), siteId),
    path.join(getJfRoot(), "packages-installed", "sites", siteId),
    path.join(cacheStorageDir(), siteId.toLowerCase()),
  ];
  for (const hostname of hostnames) {
    if (/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(hostname) && !hostname.includes("..")) {
      folders.push(path.join(getJfRoot(), "static-export-sites", hostname));
    }
  }
  for (const folder of folders) {
    await fs.rm(folder, { recursive: true, force: true });
  }
  try {
    await getUploadStore().deletePrefix(`${siteId}/`);
  } catch (err) {
    console.error("[justflows] Could not delete uploaded files for", siteId, err);
  }
}

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

async function deleteSiteRows(client: Pick<DbClient, "run">, siteIds: string[], tenantId: string, allowMissingTables = false): Promise<void> {
  const remove = async (sql: string, id: string): Promise<void> => {
    try {
      await client.run(sql, [id]);
    } catch (error) {
      // A failed provisioning attempt may never have created these tables.
      // Only separate content databases may be incomplete; root cleanup stays strict.
      if (!allowMissingTables || !["ER_NO_SUCH_TABLE", "42P01"].includes(databaseErrorCode(error) ?? "")) throw error;
    }
  };
  for (const siteId of siteIds) {
    await remove("DELETE FROM sites WHERE id = ?", siteId);
  }
  await remove("DELETE FROM tenants WHERE id = ?", tenantId);
}

/**
 * Removes a workspace that is suspended or already marked deleted: its pages,
 * users, files, and the row on the platform list. A database shared with other
 * workspaces is not dropped. The platform workspace cannot be removed.
 */
export async function purgeDeletedTenant(tenantId: string, actorId: string | null): Promise<PurgeResult | PurgeFailure> {
  if (!UUID.test(tenantId)) return { ok: false, status: 400, error: "Workspace not found." };
  const db = await getControlDb();
  const tenants = await db.query<TenantRow>("SELECT id, slug, status, updated_at FROM tenants WHERE id = ? LIMIT 1", [tenantId]);
  const tenant = tenants[0];
  if (!tenant) return { ok: false, status: 404, error: "Workspace not found." };
  if (tenant.slug === "primary") return { ok: false, status: 403, error: "The platform workspace cannot be deleted." };
  if (tenant.status !== "deleted" && tenant.status !== "suspended") {
    return { ok: false, status: 409, error: "Suspend the website before it can be removed." };
  }

  const sites = await db.query<SiteRow>("SELECT id, url, database_choice FROM sites WHERE tenant_id = ?", [tenantId]);
  const domains = await db.query<{ site_id: string; hostname: string }>("SELECT site_id, hostname FROM site_domains WHERE site_id IN (SELECT id FROM sites WHERE tenant_id = ?)", [tenantId]);
  const hostnamesBySite = new Map<string, string[]>();
  for (const site of sites) {
    const names = new Set<string>();
    const fromUrl = hostnameFromUrl(String(site.url));
    if (fromUrl) names.add(fromUrl);
    for (const domain of domains) {
      if (domain.site_id === site.id && domain.hostname) names.add(String(domain.hostname).toLowerCase());
    }
    hostnamesBySite.set(site.id, [...names]);
  }
  for (const site of sites) {
    await removeSiteFiles(site.id, hostnamesBySite.get(site.id) ?? []);
  }
  const { releaseSitesAtProvider } = await import("../domains/custom-domains.js");
  await releaseSitesAtProvider(sites.map((site) => String(site.id)));

  const databases = await db.query<DatabaseRow>(
    `SELECT host, port, database_name, username, password_ciphertext FROM tenant_databases
     WHERE tenant_id = ? AND mode = 'separate' AND database_name IS NOT NULL AND host IS NOT NULL`,
    [tenantId],
  );
  const seen = new Set<string>();
  for (const row of databases) {
    const key = `${row.host}:${row.port}:${row.database_name}`;
    if (seen.has(key) || installationDatabase(row.host, row.database_name)) continue;
    seen.add(key);
    const others = await db.query<{ count: number | string }>(
      `SELECT COUNT(*) AS count FROM tenant_databases
       WHERE mode = 'separate' AND host = ? AND port = ? AND database_name = ? AND tenant_id <> ?`,
      [row.host, row.port, row.database_name, tenantId],
    );
    const shared = Number(others[0]?.count ?? 0) > 0;
    const password = decryptSecret(row.password_ciphertext);
    const engine = driver();
    let content: DbClient | undefined;
    try {
      content = await createDbClient({
        driver: engine,
        host: row.host,
        port: String(row.port),
        database: row.database_name,
        username: row.username,
        password,
      });
      await deleteSiteRows(content, sites.map((site) => site.id), tenantId, true);
    } catch (error) {
      // The separate database may already be gone. Do not hide authentication,
      // connection, or other SQL failures that could leave customer data behind.
      if (!["ER_BAD_DB_ERROR", "3D000"].includes(databaseErrorCode(error) ?? "")) throw error;
    } finally {
      await content?.close();
    }
    if (!shared) {
      try {
        const admin = await createDbClient({
          driver: engine,
          host: row.host,
          port: String(row.port),
          database: engine === "postgres" ? "postgres" : "mysql",
          username: row.username,
          password,
        });
        try {
          await admin.run(`DROP DATABASE IF EXISTS ${quoteDatabaseIdent(row.database_name, engine)}`);
        } finally {
          await admin.close();
        }
      } catch (err) {
        console.error("[justflows] Separate database was emptied but could not be dropped:", row.database_name, err);
      }
    }
  }

  await deleteSiteRows(db, sites.map((site) => site.id), tenantId);
  const actor = actorId && UUID.test(actorId) ? actorId : null;
  await db.run(
    "INSERT INTO platform_audit (id, actor_id, action, target, detail, created_at) VALUES (?, ?, 'tenant.purged', ?, ?, ?)",
    [randomUUID(), actor, tenantId, `removed ${sites.length} site(s)`, stamp()],
  );
  return { ok: true, tenantId };
}

export function deletedLongEnough(updatedAt: string | Date, days: number, nowMs = Date.now()): boolean {
  if (days < 1) return false;
  const time = updatedAt instanceof Date ? updatedAt.getTime() : Date.parse(String(updatedAt).replace(" ", "T") + "Z");
  if (!Number.isFinite(time)) return false;
  return nowMs - time >= days * 86_400_000;
}
