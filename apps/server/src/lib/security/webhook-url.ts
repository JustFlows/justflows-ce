// SPDX-License-Identifier: MIT

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255) ? bytes : null;
}

function blockedIpv4Bytes([a, b, c]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    a! >= 224
  );
}

/** Parse any textual IPv6 form (compressed, expanded, dotted tail) into eight 16-bit groups. */
function parseIpv6(address: string): number[] | null {
  let text = (address.toLowerCase().split("%")[0] ?? "").replace(/^\[|\]$/g, "");
  const tail = text.match(/:(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const v4 = parseIpv4(tail[1]!);
    if (!v4) return null;
    const hi = ((v4[0]! << 8) | v4[1]!).toString(16);
    const lo = ((v4[2]! << 8) | v4[3]!).toString(16);
    text = `${text.slice(0, -tail[1]!.length)}${hi}:${lo}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

function embeddedIpv4(groups: number[], from: number): number[] {
  return [groups[from]! >> 8, groups[from]! & 0xff, groups[from + 1]! >> 8, groups[from + 1]! & 0xff];
}

function blockedIpv6(address: string): boolean {
  const g = parseIpv6(address);
  if (!g) return true;
  const zeroPrefix = (count: number) => g.slice(0, count).every((group) => group === 0);
  // ::/96 covers ::, ::1 and the deprecated IPv4-compatible form; ::ffff:0:0/96 is IPv4-mapped.
  if (zeroPrefix(6)) return g[6] === 0 ? true : blockedIpv4Bytes(embeddedIpv4(g, 6));
  if (zeroPrefix(5) && g[5] === 0xffff) return blockedIpv4Bytes(embeddedIpv4(g, 6));
  // 64:ff9b::/96 well-known NAT64 maps an IPv4 address; 64:ff9b:1::/48 is local-use NAT64.
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    if (g[2] === 1) return true;
    if (g.slice(2, 6).every((group) => group === 0)) return blockedIpv4Bytes(embeddedIpv4(g, 6));
  }
  // 6to4 embeds the relay's IPv4 address in bits 16-48.
  if (g[0] === 0x2002) return blockedIpv4Bytes(embeddedIpv4(g, 1));
  return (
    (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) || // discard 100::/64
    (g[0] === 0x2001 && g[1] === 0) || // Teredo
    (g[0] === 0x2001 && g[1] === 0xdb8) || // documentation
    (g[0]! & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (g[0]! & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (g[0]! & 0xffc0) === 0xfec0 || // site-local fec0::/10
    (g[0]! & 0xff00) === 0xff00 // multicast
  );
}

export function isBlockedWebhookAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, "");
  const family = isIP(host.split("%")[0] ?? "");
  if (family === 4) {
    const bytes = parseIpv4(host);
    return bytes ? blockedIpv4Bytes(bytes) : true;
  }
  return family === 6 ? blockedIpv6(host) : true;
}

export function isLocalHostName(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  return name === "localhost" || name.endsWith(".localhost") || name.endsWith(".local");
}

/**
 * Validate both the URL and every current DNS answer. Called again at delivery
 * time. This is a pre-flight check only; the request itself must go through
 * `pinnedFetch` so the connection re-checks the address it actually dials.
 */
export async function validateWebhookUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Endpoint must be a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Endpoint must use HTTP or HTTPS");
  if (url.username || url.password) throw new Error("Endpoint credentials are not allowed");
  if (url.port && url.port !== "80" && url.port !== "443")
    throw new Error("Endpoint port must be 80 or 443");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isLocalHostName(host)) {
    throw new Error("Private webhook endpoints are not allowed");
  }
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedWebhookAddress(address))) {
    throw new Error("Private webhook endpoints are not allowed");
  }
  return url;
}
