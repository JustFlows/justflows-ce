// SPDX-License-Identifier: MIT

import {
  DomainProviderError,
  type CertificateState,
  type DnsRecord,
  type DnsRecordInput,
  type DomainProvider,
  type ZoneInfo,
  type ZoneSetup,
} from "./types.js";

const API = "https://api.bunny.net";
const TIMEOUT_MS = 15_000;

/** Bunny DNS record type codes. */
const TYPE_CODE: Record<string, number> = {
  A: 0,
  AAAA: 1,
  CNAME: 2,
  TXT: 3,
  MX: 4,
  PULLZONE: 7,
  SRV: 8,
  CAA: 9,
};
const CODE_TYPE = new Map(Object.entries(TYPE_CODE).map(([type, code]) => [code, type]));

export const BUNNY_NAMESERVERS = ["kiki.bunny.net", "coco.bunny.net"] as const;
/** Glue addresses an operator gives their own nameserver names. */
export const BUNNY_NAMESERVER_IPS = [
  { ipv4: "91.200.176.1", ipv6: "2400:52e0:fff0::1" },
  { ipv4: "109.104.147.1", ipv6: "2400:52e0:fff2::1" },
] as const;

type Fetch = typeof fetch;

interface BunnyRecord {
  Id?: number;
  Type?: number;
  Name?: string;
  Value?: string;
  Ttl?: number;
  Priority?: number;
  PullZoneId?: number;
}

interface BunnyZone {
  Id?: number;
  Records?: BunnyRecord[];
  CustomNameserversEnabled?: boolean;
  Nameserver1?: string;
  Nameserver2?: string;
}

interface BunnyPullZone {
  Hostnames?: Array<{ Value?: string; IsSystemHostname?: boolean; HasCertificate?: boolean }>;
}

export interface BunnyDomainConfig {
  apiKey: string;
  pullZoneId: string;
}

async function errorText(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { Message?: unknown; message?: unknown };
    const message =
      typeof body.Message === "string"
        ? body.Message
        : typeof body.message === "string"
          ? body.message
          : "";
    return message.replace(/[\r\n]/g, " ").slice(0, 200);
  } catch {
    return "";
  }
}

export function createBunnyDomainProvider(
  config: BunnyDomainConfig,
  fetchImpl: Fetch = fetch,
): DomainProvider {
  const zone = config.pullZoneId.trim();

  async function call<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    if (!config.apiKey) throw new DomainProviderError("No Bunny.net API key is saved.");
    let response: Response;
    try {
      response = await fetchImpl(`${API}${path}`, {
        method,
        headers: {
          AccessKey: config.apiKey,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new DomainProviderError("Bunny.net could not be reached.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new DomainProviderError("Bunny.net rejected the API key.", response.status);
    }
    if (!response.ok) {
      const detail = await errorText(response);
      throw new DomainProviderError(
        detail ? `Bunny.net: ${detail}` : `Bunny.net answered ${response.status}.`,
        response.status,
      );
    }
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  function pullZonePath(suffix = ""): string {
    if (!/^\d{1,20}$/.test(zone))
      throw new DomainProviderError("No Bunny pull zone is configured.");
    return `/pullzone/${zone}${suffix}`;
  }

  function toRecord(record: BunnyRecord): DnsRecord {
    const type = CODE_TYPE.get(Number(record.Type)) ?? "OTHER";
    return {
      id: String(record.Id ?? ""),
      type: type as DnsRecord["type"],
      name: String(record.Name ?? ""),
      value:
        type === "PULLZONE"
          ? `pull zone ${record.PullZoneId ?? ""}`.trim()
          : String(record.Value ?? ""),
      ttl: Number(record.Ttl ?? 0),
      priority: record.Priority == null ? null : Number(record.Priority),
      managed: type === "PULLZONE" && String(record.PullZoneId ?? "") === zone,
    };
  }

  return {
    id: "bunny",
    hostsZones: true,

    async verify() {
      const pull = await call<BunnyPullZone>("GET", pullZonePath());
      const system = pull?.Hostnames?.find((host) => host.IsSystemHostname && host.Value);
      return { cnameTarget: system?.Value ? String(system.Value).toLowerCase() : null };
    },

    async attachHostname(hostname) {
      try {
        await call("POST", pullZonePath("/addHostname"), { Hostname: hostname });
      } catch (err) {
        // Adding a hostname the zone already has is not a failure.
        if (
          err instanceof DomainProviderError &&
          err.status === 400 &&
          /already|exist|taken/i.test(err.message)
        )
          return;
        throw err;
      }
    },

    async detachHostname(hostname) {
      try {
        await call("DELETE", pullZonePath("/removeHostname"), { Hostname: hostname });
      } catch (err) {
        if (err instanceof DomainProviderError && (err.status === 404 || err.status === 400))
          return;
        throw err;
      }
    },

    async issueCertificate(hostname): Promise<CertificateState> {
      const pull = await call<BunnyPullZone>("GET", pullZonePath());
      const existing = pull?.Hostnames?.find(
        (host) => String(host.Value ?? "").toLowerCase() === hostname,
      );
      if (existing?.HasCertificate) return "issued";
      try {
        await call("GET", `/pullzone/loadFreeCertificate?hostname=${encodeURIComponent(hostname)}`);
      } catch (err) {
        // DNS has not reached Bunny yet. The next check tries again.
        if (err instanceof DomainProviderError && err.status === 400) return "pending";
        throw err;
      }
      try {
        await call("POST", pullZonePath("/setForceSSL"), { Hostname: hostname, ForceSSL: true });
      } catch {
        // The certificate is there; forcing HTTPS can be retried by hand.
      }
      return "issued";
    },

    async createZone(domain, setup: ZoneSetup): Promise<ZoneInfo> {
      const created = await call<BunnyZone>("POST", "/dnszone", { Domain: domain });
      const zoneId = created?.Id;
      if (!zoneId) throw new DomainProviderError("Bunny.net did not return the new DNS zone.");
      const id = String(zoneId);
      try {
        if (setup.nameservers.length >= 2 || setup.soaEmail) {
          await call("POST", `/dnszone/${id}`, {
            ...(setup.nameservers.length >= 2
              ? {
                  CustomNameserversEnabled: true,
                  Nameserver1: setup.nameservers[0],
                  Nameserver2: setup.nameservers[1],
                }
              : {}),
            ...(setup.soaEmail ? { SoaEmail: setup.soaEmail } : {}),
          });
        }
        for (const name of setup.serve) {
          await call("PUT", `/dnszone/${id}/records`, {
            Type: TYPE_CODE.PULLZONE,
            Name: name,
            Value: "",
            Ttl: 300,
            PullZoneId: Number(zone),
          });
        }
      } catch (err) {
        await call("DELETE", `/dnszone/${id}`).catch(() => undefined);
        throw err;
      }
      return {
        zoneId: id,
        nameservers:
          setup.nameservers.length >= 2 ? setup.nameservers.slice(0, 2) : [...BUNNY_NAMESERVERS],
      };
    },

    async deleteZone(zoneId) {
      try {
        await call("DELETE", `/dnszone/${encodeURIComponent(zoneId)}`);
      } catch (err) {
        if (err instanceof DomainProviderError && err.status === 404) return;
        throw err;
      }
    },

    async listRecords(zoneId) {
      const found = await call<BunnyZone>("GET", `/dnszone/${encodeURIComponent(zoneId)}`);
      return (found?.Records ?? []).map(toRecord);
    },

    async addRecord(zoneId, record: DnsRecordInput) {
      const created = await call<BunnyRecord>(
        "PUT",
        `/dnszone/${encodeURIComponent(zoneId)}/records`,
        {
          Type: TYPE_CODE[record.type],
          Name: record.name,
          Value: record.value,
          Ttl: record.ttl,
          ...(record.priority == null ? {} : { Priority: record.priority }),
          ...(record.weight == null ? {} : { Weight: record.weight }),
          ...(record.port == null ? {} : { Port: record.port }),
        },
      );
      if (!created) throw new DomainProviderError("Bunny.net did not return the new record.");
      return toRecord(created);
    },

    async deleteRecord(zoneId, recordId) {
      await call(
        "DELETE",
        `/dnszone/${encodeURIComponent(zoneId)}/records/${encodeURIComponent(recordId)}`,
      );
    },
  };
}
