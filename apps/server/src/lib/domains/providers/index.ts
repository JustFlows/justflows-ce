// SPDX-License-Identifier: MIT

import { bunnyApiKey, type StoredDomainSettings } from "../domain-settings.js";
import { createBunnyDomainProvider } from "./bunny.js";
import { DomainProviderError, type DomainProvider } from "./types.js";

/**
 * The operator serves custom hostnames themselves: DNS points at this server,
 * and the reverse proxy issues certificates (for example Caddy on-demand TLS
 * asking `/api/domains/tls-allowed`).
 */
export const manualDomainProvider: DomainProvider = {
  id: "manual",
  hostsZones: false,
  async verify() {
    return { cnameTarget: null };
  },
  async attachHostname() {},
  async detachHostname() {},
  async issueCertificate() {
    return "external";
  },
  async createZone() {
    throw new DomainProviderError("This installation does not host DNS zones.");
  },
  async deleteZone() {},
  async listRecords() {
    return [];
  },
  async addRecord() {
    throw new DomainProviderError("This installation does not host DNS zones.");
  },
  async deleteRecord() {},
};

export async function domainProviderFor(settings: StoredDomainSettings): Promise<DomainProvider> {
  if (settings.provider === "bunny") {
    return createBunnyDomainProvider({
      apiKey: await bunnyApiKey(settings),
      pullZoneId: settings.bunny.pullZoneId,
    });
  }
  return manualDomainProvider;
}

export { DomainProviderError } from "./types.js";
export type { DnsRecord, DnsRecordInput, DomainProvider } from "./types.js";
