// SPDX-License-Identifier: MIT
import { isAssignableRole } from "./assignable-roles.js";
import { getGeneralSettings } from "../settings/general-settings.js";

/** Resolve access without changing the stored assignment, so reactivation restores it. */
export async function effectivePrimaryRole(siteId: string, storedRole: string): Promise<string> {
  if (await isAssignableRole(storedRole)) return storedRole;
  const { defaultRole } = await getGeneralSettings(siteId);
  return defaultRole;
}
