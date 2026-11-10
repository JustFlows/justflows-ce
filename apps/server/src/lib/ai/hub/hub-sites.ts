// SPDX-License-Identifier: MIT

import { isIP } from "node:net";
import { getControlDb } from "../../database/db.js";
import { pinnedFetch } from "../../security/pinned-fetch.js";
import { isLocalHostName } from "../../security/webhook-url.js";
import { normalizeHostname } from "../../tenancy/host.js";
import { allowLocalSites, hubCallbackUrl, hubHost, hubOrigin } from "./hub-config.js";

/**
 * Connected sites: discovery, validation and the hub's OAuth client on each.
 *
 * A site is any Justflows installation with a public HTTPS address: a
 * `*.justflows.com` site, a custom domain on Justflows Cloud, or a
 * self-hosted server. The hub never trusts the address the user typed; it
 * reads the site's own OAuth metadata and requires every endpoint to live on
 * that same origin.
 */

export class HubSiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubSiteError";
  }
}

export interface HubSite {
  origin: string;
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string | null;
  resource: string;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Outbound requests refuse private and loopback addresses at connect time and
 * never follow redirects. Local testing (`allowLocalSites`) lifts the address
 * check only.
 */
const defaultFetcher: Fetcher = (url, init) =>
  pinnedFetch(url, { ...init, redirect: "manual", allowPrivate: allowLocalSites() });

let fetcher: Fetcher = defaultFetcher;

/** Replace the outbound fetch. Tests only. */
export function setHubFetchForTests(next: Fetcher | null): void {
  fetcher = next ?? defaultFetcher;
}

/** Fetch from a connected site with a timeout. */
export function siteFetch(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  return fetcher(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
}

/**
 * Turn what the user typed into a site origin: `mysite.justflows.com`,
 * `https://www.example.com/admin` and `www.example.com.` all become
 * `https://host`. Only HTTPS on the default port is accepted.
 */
export function siteOriginFromInput(input: unknown): string {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw || raw.length > 300) throw new HubSiteError("Enter your site address, for example mysite.justflows.com.");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new HubSiteError("Enter your site address, for example mysite.justflows.com.");
  }
  if (url.username || url.password) throw new HubSiteError("Remove the user name and password from the address.");
  const host = normalizeHostname(url.hostname);
  if (allowLocalSites() && (url.protocol === "http:" || url.protocol === "https:")) {
    if (!host) throw new HubSiteError("Enter your site address, for example mysite.justflows.com.");
    if (host === hubHost()) throw new HubSiteError("Enter the address of your own site, not this connection service.");
    return url.origin;
  }
  if (url.protocol !== "https:") throw new HubSiteError("Your site must use HTTPS.");
  if (url.port && url.port !== "443") throw new HubSiteError("Your site must use the standard HTTPS port.");
  if (!host || !host.includes(".") || isIP(host) || isLocalHostName(host)) {
    throw new HubSiteError("Enter the public domain name of your site.");
  }
  if (host === hubHost()) throw new HubSiteError("Enter the address of your own site, not this connection service.");
  return `https://${host}`;
}

async function readJson(response: Response, what: string): Promise<Record<string, unknown>> {
  if (!response.ok) throw new HubSiteError(`${what} answered with HTTP ${response.status}.`);
  const text = await response.text();
  if (text.length > 65_536) throw new HubSiteError(`${what} returned an unexpectedly large response.`);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /** Falls through to the error below. */
  }
  throw new HubSiteError(`${what} did not return valid JSON.`);
}

function sameOriginUrl(origin: string, value: unknown, field: string): string {
  if (typeof value !== "string") throw new HubSiteError(`The site does not advertise ${field}.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HubSiteError(`The site's ${field} is not a valid URL.`);
  }
  if (url.origin !== origin) throw new HubSiteError(`The site's ${field} is on a different address.`);
  return url.toString();
}

const UNREACHABLE =
  "We couldn't reach a Justflows site at that address. Check the address and that MCP is turned on under Settings → AI.";

interface Discovery {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  revocationEndpoint: string | null;
  resource: string;
}

/** Read and validate the site's protected-resource and authorization-server metadata. */
export async function discoverSite(origin: string): Promise<Discovery> {
  let resourceMeta: Record<string, unknown>;
  let serverMeta: Record<string, unknown>;
  try {
    resourceMeta = await readJson(
      await siteFetch(`${origin}/.well-known/oauth-protected-resource/api/mcp`, { headers: { accept: "application/json" } }),
      "The site",
    );
    serverMeta = await readJson(
      await siteFetch(`${origin}/.well-known/oauth-authorization-server`, { headers: { accept: "application/json" } }),
      "The site",
    );
  } catch (err) {
    if (err instanceof HubSiteError) throw new HubSiteError(UNREACHABLE);
    throw new HubSiteError(UNREACHABLE);
  }
  const resource = `${origin}/api/mcp`;
  if (resourceMeta.resource !== resource) throw new HubSiteError(UNREACHABLE);
  const servers = Array.isArray(resourceMeta.authorization_servers) ? resourceMeta.authorization_servers : [];
  if (!servers.includes(origin) || serverMeta.issuer !== origin) {
    throw new HubSiteError("That site's sign-in service is on a different address, so it can't be connected here.");
  }
  const methods = Array.isArray(serverMeta.code_challenge_methods_supported)
    ? serverMeta.code_challenge_methods_supported
    : [];
  if (!methods.includes("S256")) throw new HubSiteError("That site does not support secure sign-in (PKCE).");
  return {
    authorizationEndpoint: sameOriginUrl(origin, serverMeta.authorization_endpoint, "an authorization endpoint"),
    tokenEndpoint: sameOriginUrl(origin, serverMeta.token_endpoint, "a token endpoint"),
    registrationEndpoint: sameOriginUrl(origin, serverMeta.registration_endpoint, "client registration"),
    revocationEndpoint: serverMeta.revocation_endpoint
      ? sameOriginUrl(origin, serverMeta.revocation_endpoint, "a revocation endpoint")
      : null,
    resource,
  };
}

/** Register the hub as a public OAuth client (PKCE, no secret) on the site. */
async function registerOnSite(discovery: Discovery): Promise<string> {
  let body: Record<string, unknown>;
  try {
    body = await readJson(
      await siteFetch(discovery.registrationEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          client_name: "Justflows Connect",
          client_uri: hubOrigin(),
          redirect_uris: [hubCallbackUrl()],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      }),
      "The site's client registration",
    );
  } catch {
    throw new HubSiteError("The site refused to register this connection. Try again in a few minutes.");
  }
  if (typeof body.client_id !== "string" || !body.client_id) {
    throw new HubSiteError("The site refused to register this connection. Try again in a few minutes.");
  }
  return body.client_id;
}

interface SiteRow {
  origin: string;
  client_id: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string | null;
  resource: string;
}

function fromRow(row: SiteRow): HubSite {
  return {
    origin: String(row.origin),
    clientId: String(row.client_id),
    authorizationEndpoint: String(row.authorization_endpoint),
    tokenEndpoint: String(row.token_endpoint),
    revocationEndpoint: row.revocation_endpoint ? String(row.revocation_endpoint) : null,
    resource: String(row.resource),
  };
}

/** The stored registration for a site, if the hub has one. */
export async function findSite(origin: string): Promise<HubSite | null> {
  const db = await getControlDb();
  const rows = await db.query<SiteRow>(
    "SELECT origin, client_id, authorization_endpoint, token_endpoint, revocation_endpoint, resource FROM mcp_hub_sites WHERE origin = ?",
    [origin],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

/** Forget a site's registration, so the next connection registers again. */
export async function forgetSite(origin: string): Promise<void> {
  const db = await getControlDb();
  await db.run("DELETE FROM mcp_hub_sites WHERE origin = ?", [origin]);
}

/**
 * The hub's registration on a site: the stored one, or a fresh discovery and
 * dynamic client registration that is then stored.
 */
export async function connectSite(origin: string): Promise<HubSite> {
  const known = await findSite(origin);
  if (known) return known;
  const discovery = await discoverSite(origin);
  const clientId = await registerOnSite(discovery);
  const site: HubSite = {
    origin,
    clientId,
    authorizationEndpoint: discovery.authorizationEndpoint,
    tokenEndpoint: discovery.tokenEndpoint,
    revocationEndpoint: discovery.revocationEndpoint,
    resource: discovery.resource,
  };
  const db = await getControlDb();
  await db.run("DELETE FROM mcp_hub_sites WHERE origin = ?", [origin]);
  await db.run(
    "INSERT INTO mcp_hub_sites (origin, client_id, authorization_endpoint, token_endpoint, revocation_endpoint, resource) VALUES (?, ?, ?, ?, ?, ?)",
    [site.origin, site.clientId, site.authorizationEndpoint, site.tokenEndpoint, site.revocationEndpoint, site.resource],
  );
  return site;
}
