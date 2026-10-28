// SPDX-License-Identifier: MIT

import { EditorPanelSchema, type PluginEditorPanel } from "@justflows/sdk";
import { getDb } from "../database/db.js";

/** A content editor section from an active plugin, as the editor receives it. */
export interface EditorPanelEntry extends PluginEditorPanel {
  pluginId: string;
}

/**
 * Keep the panels a stored manifest declares that still match the schema.
 * Manifests are stored JSON that may predate it, so each panel is re-checked;
 * a plugin without `admin:extend` adds none.
 */
export function panelsFromManifest(manifest: Record<string, unknown>, pluginId: string): EditorPanelEntry[] {
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  if (!permissions.includes("admin:extend") || !Array.isArray(manifest.editorPanels)) return [];
  const out: EditorPanelEntry[] = [];
  for (const raw of manifest.editorPanels.slice(0, 5)) {
    const parsed = EditorPanelSchema.safeParse(raw);
    if (parsed.success) out.push({ ...parsed.data, pluginId });
  }
  return out;
}

/** Editor panels of the plugins active on a site, in plugin id order. */
export async function listEditorPanels(siteId: string): Promise<EditorPanelEntry[]> {
  const db = await getDb();
  const rows = await db.query<{ plugin_id: string; manifest: string | Record<string, unknown> | null }>(
    "SELECT plugin_id, manifest FROM plugins WHERE site_id = ? AND status = 'active' ORDER BY plugin_id",
    [siteId],
  );
  const panels: EditorPanelEntry[] = [];
  for (const row of rows) {
    let manifest: Record<string, unknown> = {};
    try {
      manifest = typeof row.manifest === "string" ? (JSON.parse(row.manifest) as Record<string, unknown>) : (row.manifest ?? {});
    } catch {
      continue;
    }
    panels.push(...panelsFromManifest(manifest, String(row.plugin_id)));
  }
  return panels;
}
