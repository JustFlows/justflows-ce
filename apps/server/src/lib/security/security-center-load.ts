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

function classifyProxy(raw: string | undefined): NonNullable<SecurityCenterFacts["proxy"]> {
  const value = (raw ?? "loopback").trim();
  if (value === "" || value === "false" || value === "0") {
    return { mode: "disabled", value: value || "false" };
  }
  if (value === "true") return { mode: "wide", value };
  return { mode: "bounded", value: value.slice(0, 80) };
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

  const [mfa, sessions, apiKeys, headers, auditAvailable, integrity] = await Promise.all([
    siteId ? readAdminMfa(siteId) : Promise.resolve({ state: "unknown" } as const),
    siteId ? readSessions(siteId) : Promise.resolve({ state: "unknown" } as const),
    siteId ? readApiKeys(siteId) : Promise.resolve({ state: "unknown" } as const),
    readHeaders(siteId),
    siteId
      ? siteFeatureEnabled("feature.securityAudit", siteId).catch(() => false)
      : Promise.resolve(false),
    installationRoot ? readIntegrity() : Promise.resolve({ state: "unknown" } as const),
  ]);

  const facts: SecurityCenterFacts = {
    checkedAt,
    installationRoot,
    nodeVersion: process.versions.node,
    minimumNodeMajor: readMinimumNodeMajor(),
    coreVersion,
    update: classifyUpdate(coreVersion),
    debugEnabled: debug.enabled,
    production,
    installerClosed: isInstalled(),
    mfa,
    sessions,
    apiKeys,
    appUrl: appUrlScheme(appUrl),
    cookieSecure: cookieWouldBeSecure(production, appUrl),
    proxy: installationRoot ? classifyProxy(process.env.TRUST_PROXY) : null,
    headers,
    auditAvailable,
    integrity,
  };
  return securityCenterReport(facts);
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
