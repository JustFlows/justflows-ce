// SPDX-License-Identifier: MIT

import { PLUGIN_ID_RE } from "@justflows/sdk";
import { getDb } from "../database/db.js";

const MAX_REQUIRES = 10;

/** Plugin ids declared in `requires`, ignoring anything that is not a plugin id. */
export function declaredPluginRequires(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== "object") return [];
  const value = (manifest as { requires?: unknown }).requires;
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !PLUGIN_ID_RE.test(entry) || ids.includes(entry)) continue;
    ids.push(entry);
    if (ids.length >= MAX_REQUIRES) break;
  }
  return ids;
}

function pluginLabel(id: string): string {
  const name = id.split(".").pop() ?? id;
  return name
    .split("-")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function joinNames(ids: string[]): string {
  const names = ids.map(pluginLabel);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Why this plugin cannot be installed or activated, or null when every
 * required plugin is ready. Install needs the other plugin on this site.
 * Activation needs it active on this site.
 */
export async function pluginRequirementError(
  siteId: string,
  manifest: unknown,
  mode: "install" | "activate",
): Promise<string | null> {
  const ids = declaredPluginRequires(manifest);
  if (ids.length === 0) return null;
  const db = await getDb();
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await db.query<{ plugin_id: string; status: string }>(
    `SELECT plugin_id, status FROM plugins WHERE site_id = ? AND plugin_id IN (${placeholders})`,
    [siteId, ...ids],
  );
  const byId = new Map(rows.map((row) => [row.plugin_id, row.status]));
  if (mode === "install") {
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length === 0) return null;
    return `Install ${joinNames(missing)} before installing this plugin.`;
  }
  const blocked = ids.filter((id) => byId.get(id) !== "active");
  if (blocked.length === 0) return null;
  const notInstalled = blocked.filter((id) => !byId.has(id));
  if (notInstalled.length === blocked.length) {
    return `Install ${joinNames(notInstalled)} before activating this plugin.`;
  }
  return `Activate ${joinNames(blocked)} before activating this plugin.`;
}
