// SPDX-License-Identifier: MIT

import {
  isRegistryListingBeta,
  isRegistryListingComingSoon,
  isRegistryListingPaid,
  isRegistryListingVisible,
} from "@justflows/sdk";

/** Drop publisher-hidden listings from a marketplace catalogue JSON body. */
export function filterMarketplaceCatalogBody(body: string): string {
  try {
    const data: unknown = JSON.parse(body);
    if (!data || typeof data !== "object" || Array.isArray(data)) return body;
    const record = data as { items?: unknown };
    if (!Array.isArray(record.items)) return body;
    return JSON.stringify({
      ...record,
      items: record.items.filter((item) => isRegistryListingVisible(item)),
    });
  } catch {
    return body;
  }
}

export function marketplaceListingIsPaid(listing: unknown): boolean {
  return isRegistryListingPaid(listing);
}

export function marketplaceListingIsVisible(listing: unknown): boolean {
  return isRegistryListingVisible(listing);
}

export function marketplaceListingIsComingSoon(listing: unknown): boolean {
  return isRegistryListingComingSoon(listing);
}

export function marketplaceListingIsBeta(listing: unknown): boolean {
  return isRegistryListingBeta(listing);
}

/** Site setting that lets administrators install `registry.beta` listings. */
export const MARKETPLACE_ALLOW_BETA_SETTING = "marketplace_allow_beta";
