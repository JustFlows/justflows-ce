// SPDX-License-Identifier: MIT

import type { DatabaseChoice, DatabaseMode, TenantStatus, UserMode } from "./context.js";

export interface HostRecord {
  hostname: string;
  siteId: string;
  tenantId: string;
  siteStatus: TenantStatus;
  tenantStatus: TenantStatus;
  userMode: UserMode;
  databaseMode: DatabaseMode;
  databaseChoice: DatabaseChoice;
  /** The site created with the installation. */
  rootSite?: boolean;
}

export type HostDecision =
  | { kind: "ready"; record: HostRecord; viaLoopback: boolean }
  | { kind: "suspended"; record: HostRecord }
  | { kind: "provisioning"; record: HostRecord }
  | { kind: "unknown" };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

export function normalizeHostname(value: string): string {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  const withoutPort = host.startsWith("[") ? host : host.replace(/:\d+$/, "");
  return withoutPort.replace(/^\[|\]$/g, "");
}

export function hostnameFromUrl(url: string): string | null {
  try {
    const host = normalizeHostname(new URL(url).hostname);
    if (!host || host.length > 253 || /[\s/\\]/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK.has(normalizeHostname(hostname));
}

/**
 * Pick the site for a Host header.
 * An unknown host never falls through to a different site. Loopback maps to
 * the only site while the installation still has exactly one, so an existing
 * single-site install keeps working before a second domain is added.
 */
export function pickHost(input: {
  hostname: string;
  records: HostRecord[];
  siteCount: number;
}): HostDecision {
  const hostname = normalizeHostname(input.hostname);
  const match = input.records.find((record) => record.hostname === hostname);
  if (match) return decide(match, false);
  if (isLoopbackHost(hostname) && input.siteCount === 1 && input.records.length === 1) {
    const only = input.records[0];
    if (only) return decide(only, true);
  }
  return { kind: "unknown" };
}

function decide(record: HostRecord, viaLoopback: boolean): HostDecision {
  if (record.tenantStatus === "suspended" || record.siteStatus === "suspended" || record.tenantStatus === "deleted" || record.siteStatus === "deleted") {
    return { kind: "suspended", record };
  }
  if (record.tenantStatus === "provisioning" || record.siteStatus === "provisioning") {
    return { kind: "provisioning", record };
  }
  return { kind: "ready", record, viaLoopback };
}

export function isValidHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (!host || host.length > 253 || host.includes("..") || /[\s/\\]/.test(host)) return false;
  return host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) || label === "localhost");
}

/** Hostname only. A pasted URL such as `http://localhost:3000/` becomes `localhost`. */
export function signupBaseDomain(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const asUrl = trimmed.includes("://") ? trimmed : trimmed.startsWith("//") ? `http:${trimmed}` : "";
  const parsed = asUrl ? hostnameFromUrl(asUrl) : null;
  const host = normalizeHostname(parsed ?? trimmed.split("/")[0] ?? "");
  if (!host || !isValidHostname(host)) return null;
  return host;
}

/** Public site URL, using the scheme and port of the page the visitor signed up on. */
export function signupSiteOrigin(hostname: string, protocol: string, hostHeader: string): string {
  const scheme = protocol.split(",")[0]?.trim() || "http";
  const host = hostHeader.split(",")[0]?.trim() ?? "";
  const port = host.startsWith("[") ? "" : (host.match(/:(\d+)$/)?.[1] ?? "");
  return `${scheme}://${hostname}${port ? `:${port}` : ""}`;
}

export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "site";
}
