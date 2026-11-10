// SPDX-License-Identifier: MIT

import { normalizeHostname } from "../../tenancy/host.js";

/**
 * MCP connection hub settings.
 *
 * The hub is off unless `MCP_HUB_HOST` names the hostname it answers on (for
 * example `mcp.justflows.com`). It also needs `MCP_HUB_SECRET`, at least 32
 * characters, which seals every token and code it hands out.
 */
export function hubHost(): string | null {
  const raw = process.env.MCP_HUB_HOST?.trim();
  if (!raw) return null;
  const host = normalizeHostname(raw);
  return host || null;
}

/** True when the hub is configured and this hostname is the hub. */
export function isHubHost(hostname: string | undefined): boolean {
  const host = hubHost();
  return Boolean(host && hostname && normalizeHostname(hostname) === host);
}

/** True outside production. Development-only hub settings are ignored in production. */
function isDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * The hub's public origin: `https://<MCP_HUB_HOST>`. For local testing,
 * `MCP_HUB_PUBLIC_URL` (for example `http://127.0.0.1:3000`) replaces it
 * outside production, as long as it names the same hostname.
 */
export function hubOrigin(): string {
  const host = hubHost();
  if (!host) throw new Error("MCP_HUB_HOST is not set");
  const override = process.env.MCP_HUB_PUBLIC_URL?.trim();
  if (override && isDevelopment()) {
    try {
      const url = new URL(override);
      if ((url.protocol === "http:" || url.protocol === "https:") && normalizeHostname(url.hostname) === host) {
        return url.origin;
      }
    } catch {
      /** Falls back to the HTTPS origin below. */
    }
  }
  return `https://${host}`;
}

/**
 * Local testing only: let the hub connect sites on `http://`, `localhost`,
 * private addresses and non-standard ports (`MCP_HUB_ALLOW_LOCAL_SITES=true`).
 * Always false in production.
 */
export function allowLocalSites(): boolean {
  return isDevelopment() && process.env.MCP_HUB_ALLOW_LOCAL_SITES?.trim().toLowerCase() === "true";
}

/** The redirect URI the hub registers on every connected site. */
export function hubCallbackUrl(): string {
  return `${hubOrigin()}/oauth/callback`;
}

/** The MCP resource ChatGPT and other clients bind their hub tokens to. */
export function hubResourceUrl(): string {
  return `${hubOrigin()}/api/mcp`;
}

/** The sealing secret. Throws when it is missing or too short. */
export function hubSecret(): string {
  const secret = process.env.MCP_HUB_SECRET?.trim() ?? "";
  if (secret.length < 32) throw new Error("MCP_HUB_SECRET must be at least 32 characters");
  return secret;
}
