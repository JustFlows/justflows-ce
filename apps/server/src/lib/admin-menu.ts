// SPDX-License-Identifier: MIT

import type { PluginAdminMenuItem } from "@justflows/sdk";
import { getDb } from "./db.js";
import type { PluginRow } from "./plugins-db.js";

/**
 * An admin nav entry as the SSR/hydrated admin consumes it: the owning plugin travels with the
 * item so the UI can attribute (and the host can de-duplicate) a page.
 */
export interface AdminMenuEntry extends PluginAdminMenuItem {
  pluginId: string;
}

const ADMIN_MENU_DOMAIN_SET = new Set([
  "content",
  "appearance",
  "extensions",
  "security",
  "system",
]);

/**
 * A plugin owns its admin pages, but only while active: an installed-but-never-
 * activated plugin, a deactivated one, or one in error state serves nothing
 * behind the page.
 */
const MENU_VISIBLE_STATUSES = new Set<PluginRow["status"]>(["active"]);

const MENU_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MENU_PATH_RE = /^\/admin\/[a-z0-9][a-z0-9\-/]*$/;

/**
 * Admin pages the host ships for first-party plugins packaged before manifests
 * could declare `adminMenu`. Keeps an already-installed 0.1.0 Analytics or Forms
 * working without a reinstall; newer packages declare their own and win.
 */
const FIRST_PARTY_ADMIN_MENU: Record<string, PluginAdminMenuItem[]> = {
  "justflows.analytics": [
    {
      id: "analytics",
      label: "Analytics",
      labelKey: "nav.analytics",
      path: "/admin/analytics",
      icon: "📊",
      domain: "extensions",
    },
  ],
  "justflows.forms": [
    {
      id: "forms",
      label: "Forms",
      labelKey: "nav.forms",
      path: "/admin/forms",
      icon: "✉",
      domain: "extensions",
    },
  ],
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Manifests are stored JSON that may predate — or lie about — the current
 * schema, so every field is re-validated here rather than trusted.
 */
function sanitizeItem(raw: unknown, pluginId: string): AdminMenuEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;

  const id = asString(item.id);
  const label = asString(item.label);
  const path = asString(item.path);
  if (!id || !label || !path) return null;
  if (!MENU_ID_RE.test(id) || !MENU_PATH_RE.test(path)) return null;
  if (path.includes("..")) return null;

  const domain = asString(item.domain);
  const icon = asString(item.icon);

  return {
    pluginId,
    id,
    label: label.slice(0, 60),
    labelKey: asString(item.labelKey)?.slice(0, 120),
    path,
    icon: icon && icon.length <= 8 ? icon : "🔌",
    domain: (domain && ADMIN_MENU_DOMAIN_SET.has(domain)
      ? domain
      : "extensions") as PluginAdminMenuItem["domain"],
    end: item.end === true ? true : undefined,
  };
}

function manifestMenu(manifest: Record<string, unknown>, pluginId: string): AdminMenuEntry[] {
  const declared = manifest.adminMenu;
  if (!Array.isArray(declared)) return [];

  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  if (!permissions.includes("admin:extend")) return [];

  return declared
    .slice(0, 10)
    .map((entry) => sanitizeItem(entry, pluginId))
    .filter((entry): entry is AdminMenuEntry => entry !== null);
}

/**
 * Admin nav entries contributed by the plugins currently installed on a site.
 * The sidebar is built from this, so a deleted plugin's pages disappear with it.
 */
export async function listPluginAdminMenu(siteId: string): Promise<AdminMenuEntry[]> {
  const db = await getDb();
  const rows = await db.query<{
    plugin_id: string;
    status: PluginRow["status"];
    manifest: string | Record<string, unknown> | null;
  }>("SELECT plugin_id, status, manifest FROM plugins WHERE site_id = ?", [siteId]);

  const entries: AdminMenuEntry[] = [];
  const seenPaths = new Set<string>();

  for (const row of rows) {
    if (!MENU_VISIBLE_STATUSES.has(row.status)) continue;

    let manifest: Record<string, unknown> = {};
    try {
      manifest =
        typeof row.manifest === "string"
          ? (JSON.parse(row.manifest) as Record<string, unknown>)
          : (row.manifest ?? {});
    } catch {
      manifest = {};
    }

    // A manifest that mentions adminMenu speaks for itself, even to say "none".
    // Only a manifest predating the field falls back to what the host knows.
    const items =
      "adminMenu" in manifest
        ? manifestMenu(manifest, row.plugin_id)
        : (FIRST_PARTY_ADMIN_MENU[row.plugin_id] ?? [])
            .map((entry) => sanitizeItem(entry, row.plugin_id))
            .filter((entry): entry is AdminMenuEntry => entry !== null);

    for (const item of items) {
      if (seenPaths.has(item.path)) continue;
      seenPaths.add(item.path);
      entries.push(item);
    }
  }

  return entries;
}
