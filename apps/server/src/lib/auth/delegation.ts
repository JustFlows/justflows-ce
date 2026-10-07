// SPDX-License-Identifier: MIT

import type { AccessScope } from "@justflows/sdk";
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
  /** The API key's or OAuth grant's resource scope, which applies to every capability it carries. */
  scopeCeiling?: AccessScope | null;
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
 *
 * A capability only counts when the actor holds it without any scope limit
 * (own content only, certain types, locales or sites), from their own policy,
 * their role, or the key or grant they act through. A scoped capability
 * cannot be delegated at all, because a capability name alone cannot carry
 * that limit to someone else.
 */
export interface DelegationAuthority {
  unrestricted: boolean;
  capabilities: ReadonlySet<string>;
  /**
   * The site's default role. Anyone gets it by signing up or accepting an
   * invitation, so it may always be assigned as a primary role — but its
   * capabilities do not become grantable on their own.
   */
  defaultRole: string | null;
}

/** Whether a scope limits anything within this site. */
export function isRestrictiveScope(scope: AccessScope | null | undefined, siteId: string): boolean {
  if (!scope) return false;
  if (scope.ownership === "self") return true;
  if (scope.contentTypes?.length || scope.locales?.length) return true;
  return Boolean(scope.siteIds?.length && !scope.siteIds.includes(siteId));
}

export async function delegationAuthority(actor: DelegatingActor, db: DbClient): Promise<DelegationAuthority> {
  if (actor.trustedCaller) return { unrestricted: true, capabilities: new Set(), defaultRole: null };
  if (actor.role === "administrator" && !actor.capabilityCeiling) {
    return { unrestricted: true, capabilities: new Set(), defaultRole: null };
  }
  const access = await getEffectiveAccess(actor.userId, actor.siteId, actor.role, db);
  const ceiling = actor.capabilityCeiling ? new Set(actor.capabilityCeiling) : null;
  const keyScoped = isRestrictiveScope(actor.scopeCeiling, actor.siteId);
  const held = keyScoped
    ? []
    : access.capabilities.filter(
        (capability) =>
          (!ceiling || ceiling.has(capability)) &&
          !isRestrictiveScope(access.policy.scopes?.[capability] as AccessScope | undefined, actor.siteId),
      );
  const defaultRole = (await getGeneralSettings(actor.siteId)).defaultRole;
  return {
    unrestricted: false,
    capabilities: new Set(held),
    defaultRole: defaultRole && defaultRole !== "administrator" ? defaultRole : null,
  };
}

export function exceedsAuthority(authority: DelegationAuthority, capabilities: Iterable<string>): boolean {
  if (authority.unrestricted) return false;
  for (const capability of capabilities) if (!authority.capabilities.has(capability)) return true;
  return false;
}

/** Capabilities a role contributes that the actor must be able to delegate (none for the default role). */
export async function roleCapabilitiesToDelegate(authority: DelegationAuthority, role: string): Promise<string[]> {
  if (authority.defaultRole && role === authority.defaultRole) return [];
  return capabilitiesOfRoles([role]);
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
