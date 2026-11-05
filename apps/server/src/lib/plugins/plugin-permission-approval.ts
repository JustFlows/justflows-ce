// SPDX-License-Identifier: MIT

/**
 * Plugin permission changes on update.
 *
 * A signature proves who published an update, not that the operator agreed to
 * what it now asks for. A permission the installed version did not declare needs
 * an administrator's approval. Permissions are not a sandbox: this is consent to
 * a declared change, not containment.
 */

/** The largest approval list a request may carry. */
export const MAX_APPROVED_PERMISSIONS = 100;

export class PluginPermissionApprovalError extends Error {
  readonly code = "permission_approval_required";

  constructor(
    readonly pluginId: string,
    readonly pluginName: string,
    readonly permissions: string[],
  ) {
    super(`This update adds permissions that need approval: ${permissions.join(", ")}`);
    this.name = "PluginPermissionApprovalError";
  }
}

function declaredPermissions(manifest: unknown): string[] {
  const declared = (manifest as { permissions?: unknown } | null)?.permissions;
  if (!Array.isArray(declared)) return [];
  return declared.filter((item): item is string => typeof item === "string");
}

/** Permissions in `incoming` that `installed` did not declare, in manifest order. */
export function addedPluginPermissions(installed: unknown, incoming: unknown): string[] {
  const known = new Set(declaredPermissions(installed));
  return [...new Set(declaredPermissions(incoming))].filter((item) => !known.has(item));
}

/**
 * Refuse a staged package that adds unapproved permissions.
 *
 * A first install has nothing to compare with and passes. Call this from the
 * installer's `verify` step so a refusal leaves the installed version in place.
 *
 * @returns The added permissions, all of them approved.
 */
export async function assertPluginPermissionsApproved(
  siteId: string,
  manifest: { id: string; name?: string; permissions?: unknown },
  approved: readonly string[] = [],
): Promise<string[]> {
  const { getPlugin } = await import("./plugins-db.js");
  const existing = await getPlugin(siteId, manifest.id);
  if (!existing) return [];
  const added = addedPluginPermissions(existing.manifest, manifest);
  if (added.every((item) => approved.includes(item))) return added;
  throw new PluginPermissionApprovalError(manifest.id, manifest.name ?? manifest.id, added);
}

/** Audit detail for an approval. Manifest text is untrusted, so it stays on one line. */
export function approvedPermissionsDetail(permissions: readonly string[]): string {
  return `added: ${permissions.join(", ")}`.replace(/[\r\n]/g, " ").slice(0, 500);
}
