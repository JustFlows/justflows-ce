// SPDX-License-Identifier: MIT

import { isIP } from "node:net";
import { BlockedAddressError, pinnedFetch } from "../security/pinned-fetch.js";
import { isBlockedWebhookAddress, isLocalHostName, validateWebhookUrl } from "../security/webhook-url.js";

/**
 * Outbound HTTP for agent features, with the webhook SSRF guard applied to the
 * first URL and to every redirect hop.
 *
 * `allowPrivate` exists only for AI provider base URLs (a local Ollama or LM
 * Studio), and only when the administrator turns on
 * `ai_allow_private_endpoints`. Media fetched for `media_upload` never sets it.
 */

export class OutboundUrlError extends Error {}

const MAX_REDIRECTS = 3;

function basicChecks(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OutboundUrlError("URL must be a valid absolute URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new OutboundUrlError("URL must use HTTP or HTTPS");
  if (url.username || url.password) throw new OutboundUrlError("Credentials in the URL are not allowed");
  return url;
}

/** Validate one URL against the SSRF policy. */
export async function assertOutboundUrl(value: string, allowPrivate = false): Promise<URL> {
  const url = basicChecks(value);
  if (allowPrivate) return url;
  try {
    return await validateWebhookUrl(url.toString());
  } catch (err) {
    // Re-word the webhook guard's messages for this context.
    const message = err instanceof Error ? err.message : "";
    if (/private/i.test(message)) throw new OutboundUrlError("Private and loopback addresses are not allowed");
    if (/port/i.test(message)) throw new OutboundUrlError("Only ports 80 and 443 are allowed");
    throw new OutboundUrlError(message.replace(/^Endpoint/, "URL") || "URL is not allowed");
  }
}

/** Whether a host is a literal private/loopback address or a local name. */
export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isLocalHostName(host)) return true;
  return isIP(host) !== 0 && isBlockedWebhookAddress(host);
}

export interface GuardedFetchOptions extends Omit<RequestInit, "redirect" | "signal"> {
  allowPrivate?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * fetch() that re-validates every redirect hop. Returns the final response
 * unread, so callers can stream it.
 */
export async function guardedFetch(value: string, options: GuardedFetchOptions = {}): Promise<Response> {
  const { allowPrivate = false, timeoutMs = 30_000, signal, ...init } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let current = value;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = await assertOutboundUrl(current, allowPrivate);
    let response: Response;
    try {
      response = await pinnedFetch(url, { ...init, allowPrivate, redirect: "manual", signal: combined });
    } catch (err) {
      if (err instanceof Error && err.cause instanceof BlockedAddressError) {
        throw new OutboundUrlError(err.cause.message);
      }
      throw err;
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      await response.body?.cancel().catch(() => undefined);
      current = new URL(response.headers.get("location")!, url).toString();
      // A redirect never keeps a request body or switches to a non-GET method.
      if (init.method && init.method !== "GET" && init.method !== "HEAD") {
        throw new OutboundUrlError("The server redirected a non-GET request");
      }
      continue;
    }
    return response;
  }
  throw new OutboundUrlError("Too many redirects");
}

/** Read a response body into memory, refusing anything over `maxBytes`. */
export async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new OutboundUrlError(`The file is larger than the ${Math.floor(maxBytes / 1_048_576)} MB limit`);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new OutboundUrlError(`The file is larger than the ${Math.floor(maxBytes / 1_048_576)} MB limit`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
