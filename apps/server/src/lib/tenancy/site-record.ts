// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import { getControlDb } from "../database/db.js";
import { encryptSecret } from "../security/secret-box.js";
import { validateDatabaseChoice, validateDatabaseTarget, effectiveDatabaseMode } from "./choice.js";
import type { DatabaseChoice, DatabaseMode, UserMode } from "./context.js";
import { borrowSeparateDatabase, dropSeparateDatabasePool, separateDatabaseForSite } from "./connections.js";
import { hostnameFromUrl, isValidHostname, normalizeHostname, siteDomainKind } from "./host.js";
import { platformBaseDomain } from "./saas-settings.js";

export interface SiteDomainEdit {
  id: string | null;
  hostname: string;
  kind: "primary" | "subdomain" | "custom";
  verified: boolean;
  isPrimary: boolean;
}

export interface SiteDatabaseEdit {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

export interface SiteEditInput {
  name: string;
  description: string;
  url: string;
  status: "active" | "suspended";
  databaseChoice: DatabaseChoice;
  domains: SiteDomainEdit[];
  database: SiteDatabaseEdit | null;
}

export interface SiteEditContext {
  currentStatus: string;
  currentChoice: DatabaseChoice;
  userMode: UserMode;
  tenantMode: DatabaseMode;
  siteDatabase: boolean;
  takenHostnames: ReadonlySet<string>;
}

export interface NormalizedSiteEdit {
  name: string;
  description: string | null;
  url: string;
  status: "active" | "suspended";
  active: boolean;
  databaseChoice: DatabaseChoice;
  domains: SiteDomainEdit[];
  database: SiteDatabaseEdit | null;
}

export interface PlatformSiteDomain {
  id: string;
  hostname: string;
  kind: string;
  verified: boolean;
  isPrimary: boolean;
}

export interface PlatformSiteDatabase {
  id: string;
  siteId: string | null;
  mode: string;
  status: string;
  driver: string | null;
  host: string;
  port: number | null;
  databaseName: string;
  username: string;
  passwordSet: boolean;
  lastError: string | null;
  scope: "site" | "workspace";
  editable: boolean;
}

export interface PlatformSiteView {
  site: {
    id: string;
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    tenantStatus: string;
    userMode: string;
    databaseMode: string;
    name: string;
    url: string;
    description: string;
    active: boolean;
    status: string;
    databaseChoice: string;
    installedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  domains: PlatformSiteDomain[];
  database: PlatformSiteDatabase | null;
}

type SiteResult = { ok: true; site: PlatformSiteView } | { ok: false; status: number; error: string };

function now(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

function asChoice(value: string): DatabaseChoice {
  if (value === "current" || value === "separate") return value;
  return "inherit";
}

function asUserMode(value: string): UserMode {
  return value === "shared" ? "shared" : "isolated";
}

function asDatabaseMode(value: string): DatabaseMode {
  return value === "separate" ? "separate" : "current";
}

export function validateSiteEdit(
  input: SiteEditInput,
  context: SiteEditContext,
): { ok: true; value: NormalizedSiteEdit } | { ok: false; error: string } {
  if (context.currentStatus !== "active" && context.currentStatus !== "suspended") {
    return { ok: false, error: "This website cannot be edited while it is provisioning or deleted." };
  }
  const name = input.name.trim();
  if (!name || name.length > 255) return { ok: false, error: "Site name is not valid." };
  const description = input.description.trim();
  if (description.length > 10000) return { ok: false, error: "Description is too long." };
  const url = input.url.trim();
  if (!/^https?:\/\//i.test(url) || url.length > 2048) {
    return { ok: false, error: "Site URL must start with http:// or https://." };
  }
  const urlHost = hostnameFromUrl(url);
  if (!urlHost || !isValidHostname(urlHost)) return { ok: false, error: "Site URL hostname is not valid." };

  if (input.domains.length < 1 || input.domains.length > 20) {
    return { ok: false, error: "Add at least one domain." };
  }
  const domains: SiteDomainEdit[] = [];
  const seen = new Set<string>();
  const ids = new Set<string>();
  let primary = 0;
  for (const domain of input.domains) {
    const hostname = normalizeHostname(domain.hostname);
    if (!isValidHostname(hostname)) return { ok: false, error: "Hostname is not valid." };
    if (seen.has(hostname)) return { ok: false, error: "Each hostname can only be listed once." };
    if (context.takenHostnames.has(hostname)) return { ok: false, error: "That hostname is already in use." };
    if (domain.id) {
      if (ids.has(domain.id)) return { ok: false, error: "Domain not found." };
      ids.add(domain.id);
    }
    seen.add(hostname);
    if (domain.isPrimary) primary += 1;
    domains.push({
      id: domain.id,
      hostname,
      kind: domain.kind,
      verified: domain.verified,
      isPrimary: domain.isPrimary,
    });
  }
  if (primary !== 1) return { ok: false, error: "Choose one primary address." };
  if (!seen.has(urlHost)) return { ok: false, error: "Site URL has to use one of this website's domains." };

  if (input.databaseChoice !== context.currentChoice) {
    const before = effectiveDatabaseMode(context.tenantMode, context.currentChoice);
    const after = effectiveDatabaseMode(context.tenantMode, input.databaseChoice);
    if (before !== "current" || after !== "current") {
      return { ok: false, error: "This website stays on the database it already uses." };
    }
  }
  const choice = validateDatabaseChoice({
    userMode: context.userMode,
    tenantMode: context.tenantMode,
    siteChoice: input.databaseChoice,
    target: input.database,
  });
  if (!choice.ok) return { ok: false, error: choice.error };

  let database: SiteDatabaseEdit | null = null;
  if (input.database) {
    if (!context.siteDatabase) return { ok: false, error: "This connection belongs to the workspace." };
    const target = {
      host: input.database.host.trim(),
      port: input.database.port,
      database: input.database.database.trim(),
      username: input.database.username.trim(),
      password: input.database.password,
    };
    const problem = validateDatabaseTarget(target);
    if (problem) return { ok: false, error: problem };
    database = target;
  }

  return {
    ok: true,
    value: {
      name,
      description: description || null,
      url,
      status: input.status,
      active: input.status === "active",
      databaseChoice: input.databaseChoice,
      domains,
      database,
    },
  };
}

interface SiteRow {
  id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  tenant_status: string;
  user_mode: string;
  database_mode: string;
  name: string;
  url: string;
  description: string | null;
  active: unknown;
  status: string;
  database_choice: string;
  installed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DomainRow {
  id: string;
  hostname: string;
  kind: string;
  verified: unknown;
  is_primary: unknown;
}

interface DatabaseRow {
  id: string;
  site_id: string | null;
  mode: string;
  status: string;
  driver: string | null;
  host: string | null;
  port: number | null;
  database_name: string | null;
  username: string | null;
  last_error: string | null;
  password_set: unknown;
}

function presentDatabase(row: DatabaseRow | undefined, siteId: string): PlatformSiteDatabase | null {
  if (!row) return null;
  const scope = row.site_id ? "site" : "workspace";
  return {
    id: String(row.id),
    siteId: row.site_id ? String(row.site_id) : null,
    mode: String(row.mode),
    status: String(row.status),
    driver: row.driver ? String(row.driver) : null,
    host: row.host ? String(row.host) : "",
    port: row.port == null ? null : Number(row.port),
    databaseName: row.database_name ? String(row.database_name) : "",
    username: row.username ? String(row.username) : "",
    passwordSet: asBool(row.password_set),
    lastError: row.last_error ? String(row.last_error) : null,
    scope,
    editable: scope === "site" && row.mode === "separate" && String(row.site_id) === siteId,
  };
}

export async function loadPlatformSite(siteId: string): Promise<PlatformSiteView | null> {
  const db = await getControlDb();
  const sites = await db.query<SiteRow>(
    `SELECT s.id, s.tenant_id, s.name, s.url, s.description, s.active, s.status, s.database_choice,
            s.installed_at, s.created_at, s.updated_at,
            t.name AS tenant_name, t.slug AS tenant_slug, t.status AS tenant_status,
            t.user_mode, t.database_mode
     FROM sites s
     JOIN tenants t ON t.id = s.tenant_id
     WHERE s.id = ?
     LIMIT 1`,
    [siteId],
  );
  const site = sites[0];
  if (!site) return null;
  const domains = await db.query<DomainRow>(
    `SELECT id, hostname, kind, verified, is_primary
     FROM site_domains
     WHERE site_id = ?
     ORDER BY is_primary DESC, hostname ASC`,
    [siteId],
  );
  const baseDomain = await platformBaseDomain();
  for (const domain of domains) {
    const kind = siteDomainKind(String(domain.hostname), baseDomain);
    if (String(domain.kind) === "custom" && kind !== "custom") {
      domain.kind = kind;
      await db.run("UPDATE site_domains SET kind = ? WHERE id = ? AND site_id = ?", [kind, String(domain.id), siteId]);
    }
  }
  const databases = await db.query<DatabaseRow>(
    `SELECT id, site_id, mode, status, driver, host, port, database_name, username, last_error,
            CASE WHEN password_ciphertext IS NULL OR password_ciphertext = '' THEN ? ELSE ? END AS password_set
     FROM tenant_databases
     WHERE tenant_id = ? AND (site_id = ? OR site_id IS NULL)`,
    [false, true, site.tenant_id, siteId],
  );
  const database = presentDatabase(
    databases.find((row) => row.site_id != null && String(row.site_id) === siteId) ??
      databases.find((row) => row.site_id == null),
    siteId,
  );
  return {
    site: {
      id: String(site.id),
      tenantId: String(site.tenant_id),
      tenantName: String(site.tenant_name),
      tenantSlug: String(site.tenant_slug),
      tenantStatus: String(site.tenant_status),
      userMode: String(site.user_mode),
      databaseMode: String(site.database_mode),
      name: String(site.name),
      url: String(site.url),
      description: site.description ? String(site.description) : "",
      active: asBool(site.active),
      status: String(site.status),
      databaseChoice: String(site.database_choice),
      installedAt: site.installed_at ? String(site.installed_at) : null,
      createdAt: String(site.created_at),
      updatedAt: String(site.updated_at),
    },
    domains: domains.map((domain) => ({
      id: String(domain.id),
      hostname: String(domain.hostname),
      kind: String(domain.kind),
      verified: asBool(domain.verified),
      isPrimary: asBool(domain.is_primary),
    })),
    database,
  };
}

export async function updatePlatformSite(siteId: string, input: SiteEditInput, actorId: string | null): Promise<SiteResult> {
  const current = await loadPlatformSite(siteId);
  if (!current) return { ok: false, status: 404, error: "That website was not found." };
  const db = await getControlDb();
  const taken = await db.query<{ hostname: string }>(
    "SELECT hostname FROM site_domains WHERE site_id <> ?",
    [siteId],
  );
  const checked = validateSiteEdit(input, {
    currentStatus: current.site.status,
    currentChoice: asChoice(current.site.databaseChoice),
    userMode: asUserMode(current.site.userMode),
    tenantMode: asDatabaseMode(current.site.databaseMode),
    siteDatabase: current.database?.editable === true,
    takenHostnames: new Set(taken.map((row) => normalizeHostname(String(row.hostname)))),
  });
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };
  const value = checked.value;
  const known = new Set(current.domains.map((domain) => domain.id));
  for (const domain of value.domains) {
    if (domain.id && !known.has(domain.id)) return { ok: false, status: 400, error: "Domain not found." };
  }

  const stamp = now();
  const domains = value.domains.map((domain) => ({ ...domain, id: domain.id ?? randomUUID() }));
  const databaseId = current.database?.editable ? current.database.id : null;
  const passwordChanged = Boolean(value.database?.password);
  try {
    await db.transaction(async (tx) => {
      await tx.run(
        `UPDATE sites
         SET name = ?, url = ?, description = ?, active = ?, status = ?, database_choice = ?, updated_at = ?
         WHERE id = ?`,
        [value.name, value.url, value.description, value.active, value.status, value.databaseChoice, stamp, siteId],
      );
      const keep = new Set(domains.map((domain) => domain.id));
      for (const domain of current.domains) {
        if (!keep.has(domain.id)) await tx.run("DELETE FROM site_domains WHERE id = ? AND site_id = ?", [domain.id, siteId]);
      }
      for (const domain of domains) {
        if (!known.has(domain.id)) continue;
        await tx.run("UPDATE site_domains SET hostname = ? WHERE id = ? AND site_id = ?", [`hold-${domain.id}`, domain.id, siteId]);
      }
      for (const domain of domains) {
        if (known.has(domain.id)) {
          await tx.run(
            `UPDATE site_domains SET hostname = ?, kind = ?, verified = ?, is_primary = ? WHERE id = ? AND site_id = ?`,
            [domain.hostname, domain.kind, domain.verified, domain.isPrimary, domain.id, siteId],
          );
        } else {
          await tx.run(
            `INSERT INTO site_domains (id, site_id, hostname, kind, verified, is_primary, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [domain.id, siteId, domain.hostname, domain.kind, domain.verified, domain.isPrimary, stamp],
          );
        }
      }
      if (value.database && databaseId) {
        if (value.database.password) {
          await tx.run(
            `UPDATE tenant_databases
             SET host = ?, port = ?, database_name = ?, username = ?, password_ciphertext = ?, updated_at = ?
             WHERE id = ? AND site_id = ?`,
            [
              value.database.host,
              value.database.port,
              value.database.database,
              value.database.username,
              encryptSecret(value.database.password),
              stamp,
              databaseId,
              siteId,
            ],
          );
        } else {
          await tx.run(
            `UPDATE tenant_databases
             SET host = ?, port = ?, database_name = ?, username = ?, updated_at = ?
             WHERE id = ? AND site_id = ?`,
            [value.database.host, value.database.port, value.database.database, value.database.username, stamp, databaseId, siteId],
          );
        }
      }
    });
  } catch (err) {
    const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
    console.error("[justflows] website update failed:", JSON.stringify(code.replace(/[\r\n]/g, "") || "failed"));
    const message = err instanceof Error ? err.message : "";
    if (code === "23505" || code === "ER_DUP_ENTRY" || /duplicate|unique/i.test(message)) {
      return { ok: false, status: 409, error: "That address is already in use." };
    }
    return { ok: false, status: 500, error: "The website could not be saved." };
  }

  if (databaseId && (passwordChanged || value.database)) await dropSeparateDatabasePool(databaseId);

  const separate = await separateDatabaseForSite(
    current.site.tenantId,
    siteId,
    value.databaseChoice,
    asDatabaseMode(current.site.databaseMode),
  );
  if (separate) {
    let client: Awaited<ReturnType<typeof borrowSeparateDatabase>> = null;
    try {
      client = await borrowSeparateDatabase(separate);
    } catch {
      client = null;
    }
    if (!client) {
      return { ok: false, status: 502, error: "The website was saved here, but its database could not be updated. Save again when that database is reachable." };
    }
    try {
      await client.transaction(async (tx) => {
        const existing = await tx.query<{ id: string }>("SELECT id FROM sites WHERE id = ? LIMIT 1", [siteId]);
        if (!existing[0]) return;
        await tx.run(
          `UPDATE sites
           SET name = ?, url = ?, description = ?, active = ?, status = ?, updated_at = ?
           WHERE id = ?`,
          [value.name, value.url, value.description, value.active, value.status, stamp, siteId],
        );
        await tx.run("DELETE FROM site_domains WHERE site_id = ?", [siteId]);
        for (const domain of domains) {
          await tx.run(
            `INSERT INTO site_domains (id, site_id, hostname, kind, verified, is_primary, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [domain.id, siteId, domain.hostname, domain.kind, domain.verified, domain.isPrimary, stamp],
          );
        }
      });
    } catch {
      console.error("[justflows] website database mirror failed");
      return { ok: false, status: 502, error: "The website was saved here, but its database could not be updated. Save again when that database is reachable." };
    }
  }

  const uuid = actorId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId) ? actorId : null;
  await db.run(
    "INSERT INTO platform_audit (id, actor_id, action, target, detail, created_at) VALUES (?, ?, 'site.updated', ?, ?, ?)",
    [randomUUID(), uuid, siteId, domains.map((domain) => domain.hostname).join(",").slice(0, 500), stamp],
  );

  const saved = await loadPlatformSite(siteId);
  if (!saved) return { ok: false, status: 404, error: "That website was not found." };
  return { ok: true, site: saved };
}
