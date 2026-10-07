// SPDX-License-Identifier: MIT

export const DNS_RECORD_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "CAA", "SRV"] as const;
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];

/** One record in a zone the platform hosts for a customer. */
export interface DnsRecord {
  id: string;
  /** `PULLZONE` and `OTHER` are listed but cannot be created from the site admin. */
  type: DnsRecordType | "PULLZONE" | "OTHER";
  /** Relative to the zone. Empty is the zone apex. */
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
  /** Created by Justflows to serve the site. A customer cannot change it. */
  managed: boolean;
}

export interface DnsRecordInput {
  type: DnsRecordType;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
  weight?: number | null;
  port?: number | null;
}

export interface ZoneSetup {
  /** Vanity nameservers. Empty keeps the provider's own. */
  nameservers: string[];
  soaEmail: string;
  /** Record names (relative to the zone, empty for apex) that should serve the site. */
  serve: string[];
}

export interface ZoneInfo {
  zoneId: string;
  nameservers: string[];
}

export class DomainProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export type CertificateState = "issued" | "pending" | "external";

/**
 * Where a connected hostname is served from and how its certificate and DNS
 * are made. `manual` leaves both to the operator (reverse proxy, Caddy).
 */
export interface DomainProvider {
  id: "manual" | "bunny";
  /** True when the provider can host a customer's DNS zone. */
  hostsZones: boolean;
  /** Check the credentials. Returns the hostname customers can CNAME to, when the provider has one. */
  verify(): Promise<{ cnameTarget: string | null }>;
  attachHostname(hostname: string): Promise<void>;
  detachHostname(hostname: string): Promise<void>;
  issueCertificate(hostname: string): Promise<CertificateState>;
  createZone(domain: string, setup: ZoneSetup): Promise<ZoneInfo>;
  deleteZone(zoneId: string): Promise<void>;
  listRecords(zoneId: string): Promise<DnsRecord[]>;
  addRecord(zoneId: string, record: DnsRecordInput): Promise<DnsRecord>;
  deleteRecord(zoneId: string, recordId: string): Promise<void>;
}
