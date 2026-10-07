// SPDX-License-Identifier: MIT

import type { DbClient } from "../database/db.js";
import { getGeneralSettings } from "../settings/general-settings.js";
import { capabilitiesOfRoles, getEffectiveAccess } from "./access-policy.js";

export interface DelegatingActor {
  siteId: string;
  userId: string;
  role: string;
  /**
   * The most this request may delegate, such as an API key's or OAuth
   * grant's capabilities. Intersected with the actor's own access.
   */
  capabilityCeiling?: readonly string[];
  /**
   * Server code that already restricts what it may assign (a plugin creating
   * users in its own registered role). Never set from request input.
   */
  trustedCaller?: boolean;
}

/**
 * What an actor may hand out. Holding `users:manage` lets you manage users;
 * it does not let you give anyone (yourself included) more than you hold.
 * Only an administrator acting with its full session may assign
 * administrator or reach beyond its own capability set.
 */
export interface DelegationAuthority {
  unrestricted: boolean;
  capabilities: ReadonlySet<string>;
}

export async function delegationAuthority(actor: DelegatingActor, db: DbClient): Promise<DelegationAuthority> {
  if (actor.trustedCaller) return { unrestricted: true, capabilities: new Set() };
  if (actor.role === "administrator" && !actor.capabilityCeiling) {
    return { unrestricted: true, capabilities: new Set() };
  }
  const access = await getEffectiveAccess(actor.userId, actor.siteId, actor.role, db);
  const ceiling = actor.capabilityCeiling ? new Set(actor.capabilityCeiling) : null;
  const held = access.capabilities.filter((capability) => !ceiling || ceiling.has(capability));
  // The site's default role is what anyone gets by signing up or accepting an
  // invitation, so handing it out is never an escalation.
  const defaultRole = (await getGeneralSettings(actor.siteId)).defaultRole;
  const baseline = defaultRole && defaultRole !== "administrator" ? await capabilitiesOfRoles([defaultRole]) : [];
  return { unrestricted: false, capabilities: new Set([...held, ...baseline]) };
}

export function exceedsAuthority(authority: DelegationAuthority, capabilities: Iterable<string>): boolean {
  if (authority.unrestricted) return false;
  for (const capability of capabilities) if (!authority.capabilities.has(capability)) return true;
  return false;
}

export async function customRoleCapabilities(db: DbClient, siteId: string, roleId: string): Promise<string[]> {
  const rows = await db.query<{ capabilities_json: string | null }>(
    "SELECT capabilities_json FROM access_roles WHERE id = ? AND site_id = ? LIMIT 1",
    [roleId, siteId],
  );
  try {
    const parsed: unknown = JSON.parse(rows[0]?.capabilities_json ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}
