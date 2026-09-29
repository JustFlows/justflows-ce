// SPDX-License-Identifier: MIT
import {
  ROLE_CAPABILITIES,
  USER_CAPABILITIES,
  effectiveCapabilities,
  scopeAllows,
  type AccessPolicy,
  type AccessResource,
  type UserCapability,
} from "@justflows/sdk";
import { getDb, type DbClient } from "../database/db.js";

/**
 * A capability id: `domain:action` (`content:read`) or `domain:group:action`
 * (`content:revisions:read`). Shared by the users and roles routes so both
 * accept the same set of ids the rest of the system actually issues.
 */
export const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9.-]{0,79}(?::[a-z][a-z0-9.-]{0,79}){1,3}$/;

export interface EffectiveAccess {
  roleId: string;
  /** Roles held next to the primary one; see listAdditionalRoles(). */
  additionalRoles: string[];
  /** Primary role (users.role) first, then additional roles. */
  roles: string[];
  capabilities: UserCapability[];
  policy: AccessPolicy;
}

interface PolicyRow {
  role_id: string | null;
  grants_json: string;
  denies_json: string;
  scopes_json: string;
  capabilities_json: string | null;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function validCapabilities(values: unknown, available: ReadonlySet<string>): UserCapability[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is UserCapability => typeof value === "string" && available.has(value)))];
}

export async function availableCapabilityDefinitions() {
  const core = USER_CAPABILITIES.map((id) => ({ id, pluginId: null, defaultRoles: [] as readonly string[] }));
  const { getPluginLoader } = await import("../plugins/plugin-runtime.js");
  return [...core, ...(getPluginLoader()?.capabilityRegistry.all() ?? [])];
}

const OWN_CONTENT_ROLES = new Set(["author", "contributor"]);
const OWN_CONTENT_CAPABILITIES = [
  "content:update",
  "content:publish",
  "content:revisions:restore",
  "content:revisions:discard",
];

type CapabilityDefinitions = Awaited<ReturnType<typeof availableCapabilityDefinitions>>;

/** Capabilities a built-in or plugin-registered role grants on its own. */
async function builtInRoleCapabilities(role: string, definitions: CapabilityDefinitions): Promise<string[]> {
  const { getPluginLoader } = await import("../plugins/plugin-runtime.js");
  const pluginRole = getPluginLoader()?.roleRegistry.get(role);
  return [
    ...(pluginRole ? pluginRole.capabilities : (ROLE_CAPABILITIES[role] ?? [])),
    ...definitions
      .filter((definition) => definition.pluginId && (definition.defaultRoles ?? ["administrator"]).includes(role))
      .map(({ id }) => id),
  ];
}

/** Every capability the given built-in or plugin roles grant, before per-user grants and denies. */
export async function capabilitiesOfRoles(roles: readonly string[]): Promise<string[]> {
  const definitions = await availableCapabilityDefinitions();
  return [...new Set((await Promise.all(roles.map((role) => builtInRoleCapabilities(role, definitions)))).flat())];
}

/**
 * Roles a user holds next to `users.role`, such as Shop's `customer` on a
 * subscriber. They only add capabilities: `requireRole()`, the session's
 * `role`, and the last-administrator guard all read the primary role, which
 * is why administrator can never be an additional role.
 */
export async function listAdditionalRoles(
  userId: string,
  siteId: string,
  db: DbClient | undefined = undefined,
): Promise<string[]> {
  const client = db ?? (await getDb());
  const rows = await client
    .query<{ role: string }>(
      "SELECT role FROM user_additional_roles WHERE user_id = ? AND site_id = ? ORDER BY role",
      [userId, siteId],
    )
    // Before migration 0035 the table does not exist: nobody has extra roles.
    .catch(() => []);
  return rows
    .map((row) => row.role)
    .filter((role): role is string => typeof role === "string" && role !== "administrator");
}

export async function getEffectiveAccess(
  userId: string,
  siteId: string,
  fallbackRole: string,
  db: DbClient | undefined = undefined,
): Promise<EffectiveAccess> {
  const client = db ?? (await getDb());
  const rows = await client.query<PolicyRow>(
    `SELECT p.role_id, p.grants_json, p.denies_json, p.scopes_json, r.capabilities_json
       FROM user_access_policies p
       LEFT JOIN access_roles r ON r.id = p.role_id AND r.site_id = p.site_id
      WHERE p.user_id = ? AND p.site_id = ? LIMIT 1`,
    [userId, siteId],
  ).catch(() => []);
  const row = rows[0];
  const definitions = await availableCapabilityDefinitions();
  const available = new Set<string>(definitions.map(({ id }) => id));
  const roleId = row?.role_id ?? fallbackRole;
  const additionalRoles = (await listAdditionalRoles(userId, siteId, client)).filter((role) => role !== fallbackRole);
  // Each role that contributes capabilities, and whether it is one of the
  // built-in roles limited to their own content. A custom primary role
  // (row.role_id set) defines its own scopes, so it counts as unlimited.
  const sources = [
    row?.role_id
      ? { role: roleId, owned: false, capabilities: validCapabilities(parseJson(row.capabilities_json, []), available) as string[] }
      : { role: fallbackRole, owned: OWN_CONTENT_ROLES.has(fallbackRole), capabilities: await builtInRoleCapabilities(fallbackRole, definitions) },
    ...(await Promise.all(additionalRoles.map(async (role) => ({
      role,
      owned: OWN_CONTENT_ROLES.has(role),
      capabilities: validCapabilities(await builtInRoleCapabilities(role, definitions), available) as string[],
    })))),
  ];
  const roleCapabilities = sources.flatMap((source) => source.capabilities) as UserCapability[];
  // Author and contributor may only change their own content. That limit
  // follows the role whether it is primary or additional, and lifts only
  // when another held role grants the same capability without it (an
  // editor who is also an author edits everything).
  const unlimited = new Set(sources.filter((source) => !source.owned).flatMap((source) => source.capabilities));
  const ownershipScopes = sources.some((source) => source.owned)
    ? Object.fromEntries(
        OWN_CONTENT_CAPABILITIES.filter((capability) => !unlimited.has(capability))
          .map((capability) => [capability, { ownership: "self" }]),
      )
    : {};
  const policy: AccessPolicy = {
    grants: validCapabilities(parseJson(row?.grants_json, []), available),
    denies: validCapabilities(parseJson(row?.denies_json, []), available),
    scopes: { ...ownershipScopes, ...parseJson(row?.scopes_json, {}) },
  };
  return {
    roleId,
    additionalRoles,
    roles: [fallbackRole, ...additionalRoles],
    capabilities: effectiveCapabilities(roleCapabilities, policy),
    policy,
  };
}

export async function userCan(
  actor: { userId: string; siteId: string; role: string },
  capability: UserCapability,
  resource: AccessResource = {},
): Promise<boolean> {
  const access = await getEffectiveAccess(actor.userId, actor.siteId, actor.role);
  return access.capabilities.includes(capability) &&
    scopeAllows(access.policy.scopes?.[capability], { siteId: actor.siteId, ...resource }, actor.userId);
}
