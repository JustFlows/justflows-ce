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
  /** The site's primary address, when it has an active one. */
  primaryHostname?: string;
  /** True when that primary address is a custom domain. */
  primaryCustom?: boolean;
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

/**
 * Where a public request should be sent instead: the site's custom primary
 * domain, when the visitor came in on another of its addresses. Admin, API,
 * and asset paths stay on the address they used, so a site can still be
 * managed while its domain is broken.
 */
export function primaryRedirectHost(input: {
  record: HostRecord;
  viaLoopback: boolean;
  method: string;
  path: string;
  adminBase: string;
}): string | null {
  const { record } = input;
  if (input.viaLoopback || !record.primaryCustom || !record.primaryHostname) return null;
  if (record.primaryHostname === record.hostname) return null;
  if (input.method !== "GET" && input.method !== "HEAD") return null;
  const path = input.path;
  const admin = input.adminBase.replace(/\/+$/, "") || "/admin";
  const kept = ["/api", "/admin", "/assets", "/uploads", "/css-providers", "/.well-known", admin];
  if (kept.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return null;
  return record.primaryHostname;
}

/**
 * Customer sites are subdomains until a custom domain can be attached.
 * `dirkswebsite.justflows.com` and a bare slug such as `construction-demo` are
 * subdomains. A hostname outside the platform domain is custom. Loopback stays primary.
 */
export function siteDomainKind(hostname: string, baseDomain: string): "primary" | "subdomain" | "custom" {
  const host = normalizeHostname(hostname);
  const base = normalizeHostname(baseDomain);
  if (!host || isLoopbackHost(host)) return "primary";
  if (base && host.endsWith(`.${base}`) && host.length > base.length + 1) return "subdomain";
  if (!host.includes(".")) return "subdomain";
  return "custom";
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
/** The stored origin of a new site: only http/https, and only a valid port. */
export function signupSiteOrigin(hostname: string, protocol: string, hostHeader: string): string {
  const claimed = protocol.split(",")[0]?.trim().toLowerCase();
  const scheme = claimed === "https" || claimed === "http" ? claimed : "https";
  const host = hostHeader.split(",")[0]?.trim() ?? "";
  const rawPort = host.startsWith("[") ? "" : (host.match(/:(\d{1,5})$/)?.[1] ?? "");
  const portNumber = Number(rawPort);
  const port = rawPort && portNumber >= 1 && portNumber <= 65535 ? String(portNumber) : "";
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
