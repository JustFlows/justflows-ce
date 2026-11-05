// SPDX-License-Identifier: MIT

import fs from "node:fs";
import path from "node:path";
import { getDb } from "../database/db.js";
import { isInstalled } from "../../middleware/install-guard.js";
import { debugMode } from "../runtime/diagnostics.js";
import { getJfRoot } from "../runtime/jf-root.js";
import { getJustflowsVersion } from "../runtime/version.js";
import { getSiteId } from "../settings/site-settings.js";
import { siteFeatureEnabled } from "../tenancy/site-features.js";
import { isInstallationRootRequest } from "../tenancy/access.js";
import { auditConfig } from "./security-audit.js";
import { getSecurityHeadersConfig } from "./security-headers.js";
import {
  securityCenterReport,
  type SecurityCenterFacts,
  type SecurityCenterReport,
} from "./security-center.js";
import {
  cachedCoreRelease,
  compareCoreVersions,
  parseCoreVersion,
} from "../updates/core-release-check.js";
import { classifyTrustedProxy } from "./trusted-proxy.js";

function sqlNow(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function appUrlScheme(url: string | undefined): SecurityCenterFacts["appUrl"] {
  const value = url?.trim() ?? "";
  if (value.startsWith("https://")) return "https";
  if (value.startsWith("http://")) return "http";
  return "missing";
}

function securityCenterProxy(raw: string | undefined): NonNullable<SecurityCenterFacts["proxy"]> {
  const proxy = classifyTrustedProxy(raw);
  return { ...proxy, value: proxy.value.slice(0, 80) };
}

/** Same decision as `setSessionCookie` in session.ts. */
function cookieWouldBeSecure(production: boolean, appUrl: string | undefined): boolean {
  return production || (appUrl ?? "").startsWith("https://");
}

function readMinimumNodeMajor(): number | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(getJfRoot(), "package.json"), "utf8")) as {
      engines?: { node?: string };
    };
    const match = />=\s*v?(\d+)/.exec(pkg.engines?.node ?? "");
    return match?.[1] ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function classifyUpdate(currentVersion: string): SecurityCenterFacts["update"] {
  const cached = cachedCoreRelease();
  if (!cached?.release?.version) return { state: "unknown" };
  const current = parseCoreVersion(currentVersion);
  const latest = parseCoreVersion(cached.release.version);
  if (!current || !latest) return { state: "unknown" };
  if (compareCoreVersions(latest, current) > 0) {
    return { state: "available", latest: cached.release.version, checkedAt: cached.checkedAt };
  }
  return { state: "current", latest: cached.release.version, checkedAt: cached.checkedAt };
}

async function readUserMode(siteId: string): Promise<"shared" | "isolated"> {
  try {
    const rows = await (await getDb()).query<{ user_mode: string }>(
      "SELECT t.user_mode FROM sites s JOIN tenants t ON t.id = s.tenant_id WHERE s.id = ? LIMIT 1",
      [siteId],
    );
    return rows[0]?.user_mode === "shared" ? "shared" : "isolated";
  } catch {
    return "isolated";
  }
}

async function readAdminMfa(siteId: string): Promise<SecurityCenterFacts["mfa"]> {
  try {
    const db = await getDb();
    const shared = (await readUserMode(siteId)) === "shared";
    const rows = shared
      ? await db.query<{ admins: unknown; enrolled: unknown }>(
          `SELECT COUNT(*) AS admins,
                  SUM(CASE WHEN u.totp_confirmed_at IS NOT NULL THEN 1 ELSE 0 END) AS enrolled
           FROM users u
           JOIN sites home ON home.id = u.site_id
           LEFT JOIN site_memberships m ON m.user_id = u.id AND m.site_id = ?
           WHERE home.tenant_id = (SELECT tenant_id FROM sites WHERE id = ?)
             AND ((u.site_id = ? AND u.role = 'administrator') OR m.role = 'administrator')`,
          [siteId, siteId, siteId],
        )
      : await db.query<{ admins: unknown; enrolled: unknown }>(
          `SELECT COUNT(*) AS admins,
                  SUM(CASE WHEN totp_confirmed_at IS NOT NULL THEN 1 ELSE 0 END) AS enrolled
           FROM users
           WHERE site_id = ? AND role = 'administrator'`,
          [siteId],
        );
    return { state: "known", admins: num(rows[0]?.admins), enrolled: num(rows[0]?.enrolled) };
  } catch {
    return { state: "unknown" };
  }
}

async function readSessions(siteId: string): Promise<SecurityCenterFacts["sessions"]> {
  try {
    const rows = await (await getDb()).query<{ active: unknown }>(
      `SELECT COUNT(*) AS active
       FROM user_sessions
       WHERE site_id = ? AND revoked_at IS NULL AND expires_at > ?`,
      [siteId, sqlNow()],
    );
    return { state: "known", active: num(rows[0]?.active) };
  } catch {
    return { state: "unknown" };
  }
}

async function readApiKeys(siteId: string): Promise<SecurityCenterFacts["apiKeys"]> {
  try {
    if (!(await siteFeatureEnabled("feature.api", siteId))) return { state: "unavailable" };
    const now = sqlNow();
    const rows = await (await getDb()).query<{ active: unknown; without_expiry: unknown }>(
      `SELECT
         SUM(CASE WHEN revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN revoked_at IS NULL AND expires_at IS NULL THEN 1 ELSE 0 END) AS without_expiry
       FROM api_keys
       WHERE site_id = ?`,
      [now, siteId],
    );
    return {
      state: "known",
      active: num(rows[0]?.active),
      withoutExpiry: num(rows[0]?.without_expiry),
    };
  } catch {
    return { state: "unknown" };
  }
}

async function readHeaders(siteId: string | null): Promise<SecurityCenterFacts["headers"]> {
  try {
    if (siteId && !(await siteFeatureEnabled("feature.securityHeaders", siteId))) {
      return { state: "unavailable" };
    }
    if (process.env.JF_SECURITY_HEADERS_DISABLED === "1") return { state: "killSwitch" };
    const audit = auditConfig(await getSecurityHeadersConfig());
    return { state: "known", critical: audit.counts.critical, warning: audit.counts.warning };
  } catch {
    return { state: "unknown" };
  }
}

/** Ids shown in one row. The rest are counted, not listed. */
const MAX_LISTED_ADVISORIES = 5;

async function readAdvisories(siteId: string, coreVersion: string): Promise<SecurityCenterFacts["advisories"]> {
  try {
    const { loadAdvisoryFeed, matchAdvisories } = await import("./security-advisories.js");
    const stored = await loadAdvisoryFeed(siteId);
    if (stored.state === "unavailable") return { state: "unavailable" };
    if (stored.state === "expired") return { state: "expired", expiresAt: stored.feed.expiresAt };

    const { listPlugins } = await import("../plugins/plugins-db.js");
    const { listThemes } = await import("../themes/themes-db.js");
    const [plugins, themes] = await Promise.all([listPlugins(siteId), listThemes(siteId)]);
    const matches = matchAdvisories(stored.feed, [
      { type: "core", id: "justflows", version: coreVersion },
      ...plugins.map((p) => ({ type: "plugin" as const, id: p.id, version: p.version })),
      ...themes.map((t) => ({ type: "theme" as const, id: t.theme_id, version: t.version })),
    ]);
    return {
      state: "current",
      issuedAt: stored.feed.issuedAt,
      affected: matches.length,
      revoked: matches.filter((match) => match.advisory.revoked).length,
      highest: matches[0]?.advisory.severity ?? null,
      ids: matches
        .slice(0, MAX_LISTED_ADVISORIES)
        .map((match) => match.advisory.id)
        .join(", "),
    };
  } catch {
    return { state: "unavailable" };
  }
}

/**
 * Evidence for the Security Center.
 * Update discovery uses the process cache only, so opening the page does not
 * call the release service. A cache miss stays unknown.
 */
export async function loadSecurityCenter(): Promise<SecurityCenterReport> {
  const checkedAt = new Date().toISOString();
  const production = process.env.NODE_ENV === "production";
  const appUrl = process.env.APP_URL;
  const installationRoot = isInstallationRootRequest();
  const debug = debugMode();
  const coreVersion = getJustflowsVersion();
  let siteId: string | null = null;
  try {
    siteId = await getSiteId();
  } catch {
    siteId = null;
  }

  const [mfa, sessions, apiKeys, headers, auditAvailable, integrity, backup] = await Promise.all([
    siteId ? readAdminMfa(siteId) : Promise.resolve({ state: "unknown" } as const),
    siteId ? readSessions(siteId) : Promise.resolve({ state: "unknown" } as const),
    siteId ? readApiKeys(siteId) : Promise.resolve({ state: "unknown" } as const),
    readHeaders(siteId),
    siteId
      ? siteFeatureEnabled("feature.securityAudit", siteId).catch(() => false)
      : Promise.resolve(false),
    installationRoot ? readIntegrity() : Promise.resolve({ state: "unknown" } as const),
    installationRoot ? readBackup() : Promise.resolve({ state: "unknown" } as const),
  ]);

  const advisories: SecurityCenterFacts["advisories"] =
    installationRoot && siteId ? await readAdvisories(siteId, coreVersion) : { state: "unavailable" };

  const facts: SecurityCenterFacts = {
    checkedAt,
    installationRoot,
    nodeVersion: process.versions.node,
    minimumNodeMajor: readMinimumNodeMajor(),
    coreVersion,
    update: classifyUpdate(coreVersion),
    advisories,
    debugEnabled: debug.enabled,
    production,
    installerClosed: isInstalled(),
    mfa,
    sessions,
    apiKeys,
    appUrl: appUrlScheme(appUrl),
    cookieSecure: cookieWouldBeSecure(production, appUrl),
    proxy: installationRoot ? securityCenterProxy(process.env.TRUST_PROXY) : null,
    headers,
    auditAvailable,
    integrity,
    backup,
  };
  return securityCenterReport(facts);
}

/** Backups are scheduled on the installation root, so a subsite has no evidence to read. */
async function readBackup(): Promise<SecurityCenterFacts["backup"]> {
  try {
    const { automaticBackupHealth } = await import("../backup/scheduled-backups.js");
    const schedule = await automaticBackupHealth();
    if (!schedule.siteId) return { state: "unknown" };
    return {
      state: "known",
      enabled: schedule.enabled,
      lastStatus: schedule.lastStatus,
      lastFinishedAt: schedule.lastFinishedAt,
      nextRunAt: schedule.nextRunAt,
      destination: schedule.destination,
    };
  } catch {
    return { state: "unknown" };
  }
}

async function readIntegrity(): Promise<SecurityCenterFacts["integrity"]> {
  try {
    const { loadIntegrityOverview } = await import("./extension-integrity.js");
    const overview = await loadIntegrityOverview(false);
    return {
      state: "known",
      verified: overview.verified,
      unverifiable: overview.unverifiable,
      failed: overview.failed,
      core: overview.core,
    };
  } catch {
    return { state: "unknown" };
  }
}
