// SPDX-License-Identifier: MIT

import { bunnyAdapter } from "./bunny.js";
import { CDN_PROVIDER_IDS, type CdnProviderAdapter, type CdnProviderId } from "./types.js";

/** Registered CDN adapters, one file each. */
const ADAPTERS: Record<CdnProviderId, CdnProviderAdapter> = {
  bunny: bunnyAdapter,
};

export function isCdnProviderId(value: unknown): value is CdnProviderId {
  return typeof value === "string" && (CDN_PROVIDER_IDS as readonly string[]).includes(value);
}

export function getCdnAdapter(id: CdnProviderId): CdnProviderAdapter {
  return ADAPTERS[id];
}

export function listCdnAdapters(): CdnProviderAdapter[] {
  return Object.values(ADAPTERS);
}

export * from "./types.js";
