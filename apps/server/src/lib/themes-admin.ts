// SPDX-License-Identifier: MIT

import { getDb } from "./db.js";
import { getSiteId } from "./site-settings.js";
import { activateTheme } from "./themes-db.js";
import { revalidateOnUpdate } from "./cache-revalidate.js";
import { auditLog } from "./audit-log.js";

/**
 * Shared theme activation behind both `routes/themes.ts` (cookie auth) and the
 * federated management API.
 */

export interface ThemeAdminActor {
  userId: string;
  role: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface ThemeAdminResult {
  status: number;
  body: unknown;
}

export async function activateThemeAdmin(
  themeId: string,
  actor: ThemeAdminActor,
): Promise<ThemeAdminResult> {
  const siteId = await getSiteId();
  if (!siteId) return { status: 503, body: { error: "No site found" } };

  await activateTheme(siteId, themeId);
  void auditLog({
    siteId,
    action: "theme.activated",
    actorId: actor.userId,
    actorRole: actor.role,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
    target: themeId,
  });
  await revalidateOnUpdate("theme", { siteId });
  try {
    const db = await getDb();
    const { getRuntimeHooks } = await import("./plugin-runtime.js");
    const rows = await db.query<{ version: string }>(
      "SELECT version FROM themes WHERE site_id = ? AND theme_id = ? LIMIT 1",
      [siteId, themeId],
    );
    await getRuntimeHooks().dispatchAction(
      "theme.activated",
      { themeId, version: rows[0]?.version ?? "0.0.0", siteId },
      { siteId, source: "http" },
    );
  } catch {
    // Hooks must not block theme activation.
  }
  return { status: 200, body: { ok: true } };
}
