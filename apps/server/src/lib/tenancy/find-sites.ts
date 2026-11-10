// SPDX-License-Identifier: MIT

import { getControlDb } from "../database/db.js";
import { sendTemplateMail } from "../email/mail.js";
import { auditLog } from "../security/audit-log.js";
import { ownerAccount } from "./platform-account.js";

/** The origin of an http(s) URL without credentials, or null. */
function publicOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

/** An owner with more sites than this gets the first ones and the account link for the rest. */
const MAX_LISTED_SITES = 100;

export interface FindSitesContext {
  ip: string | null;
  userAgent: string | null;
  /**
   * The installation's public origin (`APP_URL`). When it is empty, the root site's
   * stored URL is used. The mailed link is never built from request headers.
   */
  appUrl: string;
}

/**
 * Mail an owner the sites of every workspace they own on the installation.
 *
 * Resolves without disclosing whether `email` belongs to an owner, so the route
 * can answer the same way for every address. Only the address itself receives
 * the list. Nothing is mailed when the address owns no live site.
 */
export async function processFindSites(email: string, ctx: FindSitesContext): Promise<void> {
  const normalized = email.trim().toLowerCase();
  try {
    const db = await getControlDb();
    const roots = await db.query<{ id: string; url: string | null }>(
      "SELECT id, url FROM sites WHERE status <> 'deleted' ORDER BY created_at ASC, id ASC LIMIT 1",
    );
    const root = roots[0];
    if (!root) return;
    const rows = await db.query<{ id: string; email: string; display_name: string; site_id: string }>(
      "SELECT id, email, display_name, site_id FROM users WHERE site_id = ? AND email = ? LIMIT 1",
      [root.id, normalized],
    );
    const user = rows[0];
    if (!user) return;
    const origin = publicOrigin(ctx.appUrl) ?? publicOrigin(root.url ?? "");
    if (!origin) {
      console.error("Find-sites: set APP_URL or the root site URL so the account link can be mailed.");
      return;
    }

    const sites = (await ownerAccount(user.id))
      .flatMap((workspace) => workspace.sites)
      .filter((site): site is typeof site & { url: string } => site.url !== null);
    if (sites.length === 0) return;

    const lines = sites.slice(0, MAX_LISTED_SITES).map((site) =>
      `${site.name.replace(/[\r\n]+/g, " ").trim() || site.url}: ${site.url}${site.status === "active" ? "" : ` (${site.status})`}`,
    );
    const result = await sendTemplateMail({
      to: user.email,
      key: "core.owned-sites",
      values: {
        display_name: user.display_name || user.email,
        site_list: lines.join("\n"),
        action_url: `${origin}/account`,
      },
    });

    void auditLog({
      siteId: user.site_id,
      action: "workspace.sites_requested",
      outcome: result.ok ? "success" : "failure",
      actorId: user.id,
      actorEmail: user.email,
      target: user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      detail: result.ok ? `site list sent (${lines.length})` : `site list could not be mailed: ${result.error}`,
    });
  } catch (err) {
    console.error("Find-sites processing failed:", err);
  }
}
