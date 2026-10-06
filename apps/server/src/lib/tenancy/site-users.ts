// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import { getControlDb, getDb, runWithDatabase, type DbClient } from "../database/db.js";
import { hashPassword } from "../auth/password.js";
import { listAssignableRoles } from "../auth/assignable-roles.js";
import { revokeUserSessions } from "../auth/auth-session.js";
import { clearUserResets } from "../auth/password-reset-db.js";
import { auditLog } from "../security/audit-log.js";
import {
  createUser,
  deleteUser,
  emitUserEvent,
  getUserWithAccess,
  listUsers,
  updateUser,
  type CreateUserInput,
  type UserAdminActor,
  type UserAdminResult,
} from "../auth/users-admin.js";
import { effectiveDatabaseMode } from "./choice.js";
import { borrowSeparateDatabase, separateDatabaseForSite } from "./connections.js";
import { runWithTenant, type DatabaseChoice, type DatabaseMode, type TenantRequestContext, type UserMode } from "./context.js";

/**
 * User administration for one website, run by a platform operator from the
 * installation's admin.
 *
 * A site with isolated users keeps them in its own `users` rows, and a site on
 * a separate database keeps those rows in that database. The site's own admin
 * reaches them because the request is bound to that site. Here the request is
 * bound to the root site, so each call opens the target site's database and
 * tenant context first, then runs the same user code the site's admin uses.
 *
 * A site that should be on a separate database never falls back to the
 * installation database: a user written there would never be able to sign in.
 */

export interface PlatformOperator {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface SiteUsersScope {
  siteId: string;
  siteName: string;
  tenantName: string;
  userMode: UserMode;
  databaseMode: DatabaseMode;
  separateDatabase: boolean;
}

type ScopeResult<T> = { ok: true; scope: SiteUsersScope; value: T } | { ok: false; status: number; error: string };

interface SiteRow {
  id: string;
  name: string;
  status: string;
  tenant_id: string;
  tenant_name: string;
  database_choice: string;
  user_mode: string;
  database_mode: string;
}

function now(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function asChoice(value: string): DatabaseChoice {
  return value === "current" || value === "separate" ? value : "inherit";
}

async function loadAllowlist(db: DbClient, siteId: string): Promise<Set<string> | null> {
  try {
    const rows = await db.query<{ plugin_id: string }>(
      "SELECT plugin_id FROM plugins WHERE site_id = ? AND status = 'active'",
      [siteId],
    );
    return new Set(rows.map((row) => String(row.plugin_id)));
  } catch {
    return null;
  }
}

export async function withSiteUsers<T>(siteId: string, fn: (scope: SiteUsersScope) => Promise<T>): Promise<ScopeResult<T>> {
  const control = await getControlDb();
  const rows = await control.query<SiteRow>(
    `SELECT s.id, s.name, s.status, s.tenant_id, s.database_choice,
            t.name AS tenant_name, t.user_mode, t.database_mode
     FROM sites s
     JOIN tenants t ON t.id = s.tenant_id
     WHERE s.id = ?
     LIMIT 1`,
    [siteId],
  );
  const site = rows[0];
  if (!site) return { ok: false, status: 404, error: "That website was not found." };
  if (site.status !== "active" && site.status !== "suspended") {
    return { ok: false, status: 409, error: "This website's users cannot be managed while it is provisioning or deleted." };
  }

  const choice = asChoice(String(site.database_choice));
  const databaseMode: DatabaseMode = site.database_mode === "separate" ? "separate" : "current";
  const separate = effectiveDatabaseMode(databaseMode, choice) === "separate";
  let client: DbClient = control;
  if (separate) {
    const row = await separateDatabaseForSite(String(site.tenant_id), siteId, choice, databaseMode);
    let borrowed: DbClient | null = null;
    try {
      borrowed = row ? await borrowSeparateDatabase(row) : null;
    } catch {
      borrowed = null;
    }
    if (!borrowed) return { ok: false, status: 502, error: "This website's database is not reachable." };
    client = borrowed;
  }

  const scope: SiteUsersScope = {
    siteId,
    siteName: String(site.name),
    tenantName: String(site.tenant_name),
    userMode: site.user_mode === "shared" ? "shared" : "isolated",
    databaseMode,
    separateDatabase: separate,
  };
  const context: TenantRequestContext = {
    tenantId: String(site.tenant_id),
    siteId,
    hostname: "",
    userMode: scope.userMode,
    databaseMode,
    rootSite: false,
    activePluginIds: await loadAllowlist(client, siteId),
  };
  const value = await runWithDatabase(client, () => runWithTenant(context, () => fn(scope)));
  return { ok: true, scope, value };
}

function actorFor(siteId: string, operator: PlatformOperator): UserAdminActor {
  return {
    siteId,
    userId: operator.userId,
    // The operator acts with administrator rights on the site. The platform
    // audit row below records that it was the operator.
    role: "administrator",
    ip: operator.ip ?? null,
    userAgent: operator.userAgent ?? null,
  };
}

async function platformAudit(operator: PlatformOperator, action: string, siteId: string, detail: string): Promise<void> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operator.userId) ? operator.userId : null;
  try {
    const db = await getControlDb();
    await db.run(
      "INSERT INTO platform_audit (id, actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [randomUUID(), uuid, action, siteId, detail.slice(0, 500), now()],
    );
  } catch {
    console.error("[justflows] platform audit write failed");
  }
}

type Outcome = { status: number; body: unknown };

function fromScope<T>(result: ScopeResult<T>, map: (scope: SiteUsersScope, value: T) => Outcome): Outcome {
  if (!result.ok) return { status: result.status, body: { error: result.error } };
  return map(result.scope, result.value);
}

export async function listSiteUsers(siteId: string): Promise<Outcome> {
  const result = await withSiteUsers(siteId, async () => ({
    users: await listUsers(siteId),
    roles: (await listAssignableRoles()).map((role) => ({ id: role.id, label: role.label })),
  }));
  return fromScope(result, (scope, value) => ({ status: 200, body: { site: scope, ...value } }));
}

export async function getSiteUser(siteId: string, userId: string): Promise<Outcome> {
  const result = await withSiteUsers(siteId, () => getUserWithAccess(siteId, userId, { includeActivity: true }));
  return fromScope(result, (_scope, value) => value);
}

export async function createSiteUser(siteId: string, input: CreateUserInput, operator: PlatformOperator): Promise<Outcome> {
  const result = await withSiteUsers(siteId, async () => {
    const db = await getDb();
    const taken = await db.query<{ id: string }>(
      "SELECT id FROM users WHERE site_id = ? AND (email = ? OR username = ?) LIMIT 1",
      [siteId, input.email.toLowerCase(), input.username],
    );
    if (taken[0]) return { status: 409, body: { error: "A user with that email or username already exists on this website." } } as UserAdminResult;
    return createUser(input, actorFor(siteId, operator));
  });
  if (result.ok && result.value.status === 201) {
    const created = result.value.body as { id: string };
    await platformAudit(operator, "site.user.created", siteId, created.id);
  }
  return fromScope(result, (_scope, value) => value);
}

export interface SiteUserPatch {
  displayName?: string;
  role?: string;
}

export async function updateSiteUser(siteId: string, userId: string, patch: SiteUserPatch, operator: PlatformOperator): Promise<Outcome> {
  const result = await withSiteUsers(siteId, () => updateUser(userId, patch, actorFor(siteId, operator)));
  if (result.ok && result.value.status === 200) {
    await platformAudit(operator, "site.user.updated", siteId, `${userId}${patch.role ? ` role=${patch.role}` : ""}`);
  }
  return fromScope(result, (_scope, value) => value);
}

export async function resetSiteUserPassword(siteId: string, userId: string, password: string, operator: PlatformOperator): Promise<Outcome> {
  const result = await withSiteUsers(siteId, async (): Promise<UserAdminResult> => {
    const db = await getDb();
    const rows = await db.query<{ id: string }>("SELECT id FROM users WHERE id = ? AND site_id = ? LIMIT 1", [userId, siteId]);
    if (!rows[0]) return { status: 404, body: { error: "User not found" } };
    await db.run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND site_id = ?", [
      await hashPassword(password),
      now(),
      userId,
      siteId,
    ]);
    await revokeUserSessions(userId, siteId);
    await clearUserResets(userId, siteId);
    const actor = actorFor(siteId, operator);
    await auditLog({
      siteId,
      action: "auth.password_reset",
      actorId: actor.userId,
      actorRole: actor.role,
      ip: actor.ip,
      userAgent: actor.userAgent,
      target: userId,
    });
    await emitUserEvent("user.updated", userId, siteId);
    return { status: 200, body: { ok: true } };
  });
  if (result.ok && result.value.status === 200) await platformAudit(operator, "site.user.password_reset", siteId, userId);
  return fromScope(result, (_scope, value) => value);
}

export async function deleteSiteUser(siteId: string, userId: string, operator: PlatformOperator): Promise<Outcome> {
  const result = await withSiteUsers(siteId, () => deleteUser(userId, actorFor(siteId, operator)));
  if (result.ok && result.value.status === 200) await platformAudit(operator, "site.user.deleted", siteId, userId);
  return fromScope(result, (_scope, value) => value);
}
