// SPDX-License-Identifier: MIT

import { promises as dns } from "node:dns";

/** The record a customer adds to prove they own a hostname. */
export const CHALLENGE_PREFIX = "_justflows";
export const CHALLENGE_VALUE_PREFIX = "justflows-verify=";

export function challengeName(hostname: string): string {
  return `${CHALLENGE_PREFIX}.${hostname}`;
}

export function challengeValue(token: string): string {
  return `${CHALLENGE_VALUE_PREFIX}${token}`;
}

export interface DnsResolver {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
  resolve4(name: string): Promise<string[]>;
  resolve6(name: string): Promise<string[]>;
  resolveNs(name: string): Promise<string[]>;
}

/**
 * Ask every resolver and keep the combined answer. One public resolver can
 * cache a single address from a pool while another already has the rest.
 */
export function mergeResolvers(resolvers: readonly DnsResolver[]): DnsResolver {
  async function merge(read: (resolver: DnsResolver) => Promise<string[]>): Promise<string[]> {
    const rows = await Promise.all(resolvers.map((item) => read(item).catch(() => [] as string[])));
    const values = [...new Set(rows.flat())];
    if (values.length === 0) throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
    return values;
  }
  return {
    resolveTxt: async (name) => {
      const rows = await Promise.all(resolvers.map((item) => item.resolveTxt(name).catch(() => [] as string[][])));
      const records = rows.flat();
      if (records.length === 0) throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
      return records;
    },
    resolveCname: (name) => merge((item) => item.resolveCname(name)),
    resolve4: (name) => merge((item) => item.resolve4(name)),
    resolve6: (name) => merge((item) => item.resolve6(name)),
    resolveNs: (name) => merge((item) => item.resolveNs(name)),
  };
}

/** Public resolvers, so a stale answer cached on this host does not decide. */
export function systemResolver(): DnsResolver {
  const resolvers: dns.Resolver[] = [];
  for (const server of ["1.1.1.1", "8.8.8.8"]) {
    const resolver = new dns.Resolver({ timeout: 4000, tries: 1 });
    try {
      resolver.setServers([server]);
      resolvers.push(resolver);
    } catch {
      // Skip a server this runtime cannot use.
    }
  }
  if (resolvers.length === 0) return new dns.Resolver({ timeout: 4000, tries: 2 });
  return mergeResolvers(resolvers);
}

/**
 * An anycast name often answers with one address from a small pool. A
 * flattened ALIAS stays on one of those addresses, so keep the addresses
 * from several answers instead of the first one.
 */
const ADDRESS_SAMPLE_LIMIT = 4;

/** Skip nameserver addresses that are not a public DNS host. */
function isPublicAddress(ip: string): boolean {
  const value = ip.trim().toLowerCase();
  if (value.includes(":")) {
    return value !== "::" && value !== "::1" && !value.startsWith("fe80:") && !value.startsWith("fc") && !value.startsWith("fd");
  }
  const parts = value.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const a = parts[0] ?? -1;
  const b = parts[1] ?? -1;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

function resolverAt(server: string): DnsResolver {
  const resolver = new dns.Resolver({ timeout: 4000, tries: 1 });
  resolver.setServers([server]);
  return resolver;
}

/** NS at this name, or at the nearest parent zone that publishes them. */
async function nameserversOf(resolver: DnsResolver, hostname: string): Promise<string[]> {
  const labels = clean(hostname).split(".").filter(Boolean);
  for (let start = 0; start < labels.length - 1; start += 1) {
    const found = (await safe(resolver.resolveNs(labels.slice(start).join(".")), [] as string[])).map(clean).filter(Boolean);
    if (found.length > 0) return [...new Set(found)];
  }
  return [];
}

/**
 * Addresses from the zone's own nameservers. A public resolver can keep the
 * previous address for hours after the ALIAS has changed.
 */
async function authoritativeAddresses(
  resolver: DnsResolver,
  hostname: string,
  openResolver: (server: string) => DnsResolver,
): Promise<Set<string>> {
  const found = new Set<string>();
  const servers = new Set<string>();
  for (const ns of await nameserversOf(resolver, hostname)) {
    for (const ip of await safe(resolver.resolve4(ns), [] as string[])) {
      if (isPublicAddress(ip)) servers.add(ip);
    }
  }
  const ask = [...servers].slice(0, 4).flatMap((ip) => {
    try {
      return [openResolver(ip)];
    } catch {
      return [];
    }
  });
  let unchanged = 0;
  for (let round = 0; round < ADDRESS_SAMPLE_LIMIT && ask.length > 0; round += 1) {
    const before = found.size;
    const batches = await Promise.all(
      ask.map(async (item) => {
        const [v4, v6] = await Promise.all([
          safe(item.resolve4(hostname), [] as string[]),
          safe(item.resolve6(hostname), [] as string[]),
        ]);
        return [...v4, ...v6];
      }),
    );
    for (const ip of batches.flat()) found.add(ip.toLowerCase());
    unchanged = found.size === before ? unchanged + 1 : 0;
    if (unchanged >= 2) break;
  }
  return found;
}

async function addressesOf(resolver: DnsResolver, hostname: string): Promise<Set<string>> {
  const found = new Set<string>();
  let unchanged = 0;
  for (let round = 0; round < ADDRESS_SAMPLE_LIMIT; round += 1) {
    const [v4, v6] = await Promise.all([
      safe(resolver.resolve4(hostname), [] as string[]),
      safe(resolver.resolve6(hostname), [] as string[]),
    ]);
    const before = found.size;
    for (const ip of [...v4, ...v6]) found.add(ip.toLowerCase());
    unchanged = found.size === before ? unchanged + 1 : 0;
    if (unchanged >= 2) break;
  }
  return found;
}

async function safe<T>(lookup: Promise<T>, fallback: T): Promise<T> {
  try {
    return await lookup;
  } catch {
    return fallback;
  }
}

function clean(name: string): string {
  return name.trim().toLowerCase().replace(/\.$/, "");
}

export interface RecordsCheckInput {
  hostname: string;
  token: string;
  cnameTarget: string;
  apexAddresses: readonly string[];
}

export interface DnsCheckResult {
  ownership: boolean;
  routing: boolean;
  /** Why the check did not pass, for the site admin. Empty when it passed. */
  problem: string;
}

/**
 * Records mode: the TXT challenge proves ownership, and the hostname has to
 * reach the platform — a CNAME to the target, or addresses that match the
 * target's (a flattened apex) or the configured apex addresses.
 */
export async function checkRecords(
  input: RecordsCheckInput,
  resolver: DnsResolver,
  openResolver: (server: string) => DnsResolver = resolverAt,
): Promise<DnsCheckResult> {
  const txt = await safe(resolver.resolveTxt(challengeName(input.hostname)), [] as string[][]);
  const expected = challengeValue(input.token);
  const ownership = txt.some((chunks) => chunks.join("").trim() === expected);

  const target = clean(input.cnameTarget);
  const cnames = (await safe(resolver.resolveCname(input.hostname), [] as string[])).map(clean);
  let routing = Boolean(target) && cnames.includes(target);
  if (!routing) {
    const [ownPublic, ownAuth] = await Promise.all([
      addressesOf(resolver, input.hostname),
      authoritativeAddresses(resolver, input.hostname, openResolver),
    ]);
    const own = new Set([...ownPublic, ...ownAuth]);
    const allowed = new Set(input.apexAddresses.map((ip) => ip.toLowerCase()));
    if (target) {
      const [targetPublic, targetAuth] = await Promise.all([
        addressesOf(resolver, target),
        authoritativeAddresses(resolver, target, openResolver),
      ]);
      for (const ip of [...targetPublic, ...targetAuth]) allowed.add(ip);
    }
    routing = own.size > 0 && [...own].some((ip) => allowed.has(ip));
  }

  let problem = "";
  if (!ownership) problem = `The TXT record ${challengeName(input.hostname)} was not found yet.`;
  else if (!routing)
    problem = `${input.hostname} does not point at ${target || "this platform"} yet.`;
  return { ownership, routing, problem };
}

/** Whether the domain's public NS set is the expected one. Delegation alone never proves ownership. */
export async function checkNameservers(
  hostname: string,
  expected: readonly string[],
  resolver: DnsResolver,
): Promise<DnsCheckResult> {
  const found = new Set((await safe(resolver.resolveNs(hostname), [] as string[])).map(clean));
  const wanted = expected.map(clean).filter(Boolean);
  const ok = wanted.length > 0 && wanted.every((ns) => found.has(ns));
  return {
    ownership: false,
    routing: ok,
    problem: ok ? "" : `The nameservers of ${hostname} are not ${wanted.join(" and ")} yet.`,
  };
}

export async function hasChallenge(hostname: string, token: string, resolver: DnsResolver): Promise<boolean> {
  if (!token) return false;
  const txt = await safe(resolver.resolveTxt(challengeName(hostname)), [] as string[][]);
  const expected = challengeValue(token);
  return txt.some((chunks) => chunks.join("").trim() === expected);
}

export interface NameserverDomainInput {
  hostname: string;
  token: string;
  expected: readonly string[];
  /** Ownership was already proven on an earlier check. */
  ownershipProven: boolean;
}

/**
 * Nameservers mode: delegation routes the domain but never proves ownership.
 * The exact TXT challenge proves ownership before or after delegation. The
 * platform must not publish that challenge or allow unverified DNS edits.
 */
export async function checkNameserverDomain(
  input: NameserverDomainInput,
  resolver: DnsResolver,
): Promise<DnsCheckResult & { provenNow: boolean }> {
  const delegation = await checkNameservers(input.hostname, input.expected, resolver);
  let ownership = input.ownershipProven;
  let provenNow = false;
  if (!ownership && (await hasChallenge(input.hostname, input.token, resolver))) {
    ownership = true;
    provenNow = true;
  }
  let problem = "";
  if (!ownership) {
    problem = `The TXT record ${challengeName(input.hostname)} with the expected verification value was not found yet. Add it at the domain's authoritative DNS provider.`;
  } else if (!delegation.routing) {
    problem = delegation.problem;
  }
  return { ownership, routing: delegation.routing, problem, provenNow };
}
