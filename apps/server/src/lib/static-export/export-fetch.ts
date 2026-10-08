// SPDX-License-Identifier: MIT

import type { LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { pinnedFetch } from "../security/pinned-fetch.js";
import { isProxiedHost, secondaryExportSite } from "./config.js";

/**
 * Every request the static exporter makes goes through here.
 *
 * A secondary site crawls its own hostname, whose DNS that site's owner
 * controls. Resolving it normally would let them point the crawler at any
 * internal address. Instead:
 *
 *  - with a local listener, the site's hostname is dialled on loopback, so the
 *    request reaches this application with the right Host header and nothing
 *    else;
 *  - behind a proxy (no local listener), it goes through the public-address
 *    guard, which refuses private destinations at connect time.
 *
 * The main site's origins are loopback or operator-configured, and are
 * fetched as configured.
 */

const toLoopback: LookupFunction = (_hostname, options, callback) => {
  if (options.all) {
    (callback as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [
      { address: "127.0.0.1", family: 4 },
    ]);
    return;
  }
  callback(null, "127.0.0.1", 4);
};

const loopbackAgent = new Agent({ connect: { lookup: toLoopback } });

export async function exportFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const site = secondaryExportSite();
  if (!site) return fetch(url, init);
  const host = new URL(url).hostname.toLowerCase();
  if (host !== site.hostname && host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]") {
    throw new Error(`The exporter only fetches this site (refused ${host})`);
  }
  if (host !== site.hostname || !isProxiedHost()) {
    const response = await undiciFetch(url, {
      ...(init as Parameters<typeof undiciFetch>[1]),
      redirect: "manual",
      dispatcher: loopbackAgent,
    });
    return response as unknown as Response;
  }
  return pinnedFetch(url, { ...init, redirect: "manual" });
}
