// SPDX-License-Identifier: MIT

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { isBlockedWebhookAddress } from "./webhook-url.js";

/**
 * Outbound fetch whose socket refuses private destinations at connect time.
 *
 * Validating a hostname and then calling plain fetch() leaves a gap: the
 * connection performs its own DNS lookup, and a rebinding resolver can answer
 * differently the second time. This agent's lookup applies the same address
 * policy to the exact answers the socket is about to dial, so the checked
 * address and the connected address are the same.
 */

export class BlockedAddressError extends Error {
  code = "EJUSTFLOWSBLOCKED";
}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some(({ address }) => isBlockedWebhookAddress(address))) {
      return callback(new BlockedAddressError("Private and loopback addresses are not allowed"), "", 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

const publicAgent = new Agent({ connect: { lookup: guardedLookup } });

export interface PinnedRequestInit extends RequestInit {
  /** Skip the address policy (trusted, operator-approved private endpoints only). */
  allowPrivate?: boolean;
}

export async function pinnedFetch(url: URL | string, init: PinnedRequestInit = {}): Promise<Response> {
  const { allowPrivate = false, ...rest } = init;
  if (allowPrivate) return fetch(url, rest);
  // Sockets skip DNS lookup for an IP literal, so the agent's check never runs
  // for one; apply the same policy here.
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isBlockedWebhookAddress(host)) {
    throw new TypeError("fetch failed", {
      cause: new BlockedAddressError("Private and loopback addresses are not allowed"),
    });
  }
  const response = await undiciFetch(url, {
    ...(rest as Parameters<typeof undiciFetch>[1]),
    dispatcher: publicAgent,
  });
  return response as unknown as Response;
}
