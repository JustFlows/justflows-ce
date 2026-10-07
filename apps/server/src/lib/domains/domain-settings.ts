// SPDX-License-Identifier: MIT

import { getControlDb } from "../database/db.js";
import { decryptSecret, encryptSecret } from "../security/secret-box.js";
import { isValidHostname, normalizeHostname } from "../tenancy/host.js";

/**
 * Platform → Custom domains. One installation-wide configuration, stored in
 * `platform_settings` under `custom_domains`. What each website may use is
 * decided per site by the quota meters `feature.customDomains`,
 * `domains.custom`, and `feature.managedDns`, so a plan or a billing plugin
 * can sell them separately.
 */

export const DOMAIN_PROVIDER_IDS = ["manual", "bunny"] as const;
export type DomainProviderId = (typeof DOMAIN_PROVIDER_IDS)[number];

export const CONNECT_MODES = ["records", "nameservers"] as const;
export type ConnectMode = (typeof CONNECT_MODES)[number];

export interface DomainSettings {
  /** Master switch. Off hides Settings → Domains on every website. */
  enabled: boolean;
  provider: DomainProviderId;
  /** How a website may connect a domain. Nameservers needs Bunny DNS. */
  modes: Record<ConnectMode, boolean>;
  /** What a customer points a CNAME at, such as `justflows.b-cdn.net` or `domains.example.com`. */
  cnameTarget: string;
  /** A and AAAA values for a bare domain whose DNS host cannot alias. Optional. */
  apexAddresses: string[];
  /** Nameservers shown to customers. Empty uses the provider's own. */
  nameservers: string[];
  /** Contact address in the SOA record of a zone created for a customer. */
  soaEmail: string;
  /** Also serve `www.` when a domain is connected by nameservers. */
  includeWww: boolean;
  /** Send visitors on another address of the site to its custom primary domain. */
  redirectToPrimary: boolean;
  /** Days an unverified domain is kept before it is released. */
  pendingExpiryDays: number;
  /** Consecutive failed checks before an active domain stops being served. */
  failureThreshold: number;
  /** Where a website without access is sent to upgrade. Empty hides the link. */
  upgradeUrl: string;
  bunny: {
    pullZoneId: string;
    /** Set when this page holds its own key. Otherwise the Settings → CDN key is used. */
    apiKey: { last4: string } | null;
  };
}

interface StoredDomainSettings extends Omit<DomainSettings, "bunny"> {
  bunny: { pullZoneId: string; apiKeyCiphertext: string };
}

export interface DomainSettingsInput {
  enabled: boolean;
  provider: string;
  modes: Partial<Record<ConnectMode, boolean>>;
  cnameTarget: string;
  apexAddresses: string[];
  nameservers: string[];
  soaEmail: string;
  includeWww: boolean;
  redirectToPrimary: boolean;
  pendingExpiryDays: number;
  failureThreshold: number;
  upgradeUrl: string;
  bunny: { pullZoneId: string; apiKey?: string | null };
}

const SETTING_KEY = "custom_domains";
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]{2,39}$/i;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export function defaultDomainSettings(): StoredDomainSettings {
  return {
    enabled: false,
    provider: "manual",
    modes: { records: true, nameservers: false },
    cnameTarget: "",
    apexAddresses: [],
    nameservers: [],
    soaEmail: "",
    includeWww: true,
    redirectToPrimary: true,
    pendingExpiryDays: 7,
    failureThreshold: 3,
    upgradeUrl: "",
    bunny: { pullZoneId: "", apiKeyCiphertext: "" },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  let raw = value;
  for (let depth = 0; depth < 2 && typeof raw === "string"; depth += 1) {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function intIn(value: unknown, min: number, max: number, fallback: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** Read the stored value. Anything missing or malformed falls back to the default. */
export function parseStoredDomainSettings(value: unknown): StoredDomainSettings {
  const base = defaultDomainSettings();
  const record = asRecord(value);
  if (!record) return base;
  const modes = asRecord(record.modes) ?? {};
  const bunny = asRecord(record.bunny) ?? {};
  return {
    enabled: record.enabled === true,
    provider: record.provider === "bunny" ? "bunny" : "manual",
    modes: {
      records: modes.records === undefined ? base.modes.records : modes.records === true,
      nameservers: modes.nameservers === true,
    },
    cnameTarget: typeof record.cnameTarget === "string" ? record.cnameTarget : "",
    apexAddresses: strings(record.apexAddresses).filter((ip) => IPV4.test(ip) || IPV6.test(ip)),
    nameservers: strings(record.nameservers)
      .filter((ns) => isValidHostname(ns))
      .slice(0, 4),
    soaEmail: typeof record.soaEmail === "string" ? record.soaEmail : "",
    includeWww: record.includeWww === undefined ? base.includeWww : record.includeWww === true,
    redirectToPrimary:
      record.redirectToPrimary === undefined
        ? base.redirectToPrimary
        : record.redirectToPrimary === true,
    pendingExpiryDays: intIn(record.pendingExpiryDays, 1, 90, base.pendingExpiryDays),
    failureThreshold: intIn(record.failureThreshold, 1, 50, base.failureThreshold),
    upgradeUrl: typeof record.upgradeUrl === "string" ? record.upgradeUrl : "",
    bunny: {
      pullZoneId: typeof bunny.pullZoneId === "string" ? bunny.pullZoneId : "",
      apiKeyCiphertext: typeof bunny.apiKeyCiphertext === "string" ? bunny.apiKeyCiphertext : "",
    },
  };
}

/** The browser view. The API key never leaves the server. */
export function publicDomainSettings(stored: StoredDomainSettings): DomainSettings {
  const key = stored.bunny.apiKeyCiphertext ? decryptSecret(stored.bunny.apiKeyCiphertext) : "";
  return {
    ...stored,
    bunny: {
      pullZoneId: stored.bunny.pullZoneId,
      apiKey: key ? { last4: key.slice(-4) } : null,
    },
  };
}

/** Validate an edit. An empty or missing API key keeps the stored one; `null` clears it. */
export function buildDomainSettings(
  previous: StoredDomainSettings,
  input: DomainSettingsInput,
): { ok: true; stored: StoredDomainSettings } | { ok: false; error: string } {
  if (!(DOMAIN_PROVIDER_IDS as readonly string[]).includes(input.provider)) {
    return { ok: false, error: "Unknown domain provider." };
  }
  const provider = input.provider as DomainProviderId;
  const modes = {
    records: input.modes.records === true,
    nameservers: input.modes.nameservers === true,
  };
  if (input.enabled && !modes.records && !modes.nameservers) {
    return { ok: false, error: "Allow at least one way to connect a domain." };
  }
  if (modes.nameservers && provider !== "bunny") {
    return { ok: false, error: "Connecting by nameservers needs Bunny DNS." };
  }

  const cnameTarget = normalizeHostname(input.cnameTarget);
  if (cnameTarget && !isValidHostname(cnameTarget))
    return { ok: false, error: "The CNAME target is not a valid hostname." };
  if (input.enabled && modes.records && !cnameTarget) {
    return { ok: false, error: "Enter the hostname customers point their CNAME at." };
  }

  const apexAddresses: string[] = [];
  for (const raw of input.apexAddresses.slice(0, 8)) {
    const ip = raw.trim();
    if (!ip) continue;
    if (!IPV4.test(ip) && !IPV6.test(ip))
      return { ok: false, error: `${ip.slice(0, 60)} is not an IP address.` };
    apexAddresses.push(ip.toLowerCase());
  }

  const nameservers: string[] = [];
  for (const raw of input.nameservers.slice(0, 4)) {
    const ns = normalizeHostname(raw);
    if (!ns) continue;
    if (!isValidHostname(ns) || !ns.includes("."))
      return { ok: false, error: `${ns.slice(0, 60)} is not a nameserver hostname.` };
    nameservers.push(ns);
  }
  if (nameservers.length === 1)
    return { ok: false, error: "Enter two nameservers, or none to use the provider's." };

  const soaEmail = input.soaEmail.trim();
  if (soaEmail && !EMAIL.test(soaEmail))
    return { ok: false, error: "The SOA contact is not an email address." };

  const upgradeUrl = input.upgradeUrl.trim();
  if (upgradeUrl && (!/^https?:\/\//i.test(upgradeUrl) || upgradeUrl.length > 500)) {
    return { ok: false, error: "The upgrade link must start with http:// or https://." };
  }

  const pullZoneId = input.bunny.pullZoneId.trim();
  if (pullZoneId && !/^\d{1,20}$/.test(pullZoneId))
    return { ok: false, error: "The pull zone ID is a number." };
  if (input.enabled && provider === "bunny" && !pullZoneId)
    return { ok: false, error: "Enter the Bunny pull zone ID." };

  let apiKeyCiphertext = previous.bunny.apiKeyCiphertext;
  if (input.bunny.apiKey === null) apiKeyCiphertext = "";
  else if (input.bunny.apiKey && input.bunny.apiKey.trim()) {
    const key = input.bunny.apiKey.trim();
    if (!/^[A-Za-z0-9-]{8,200}$/.test(key))
      return { ok: false, error: "The Bunny API key is not valid." };
    apiKeyCiphertext = encryptSecret(key);
  }

  return {
    ok: true,
    stored: {
      enabled: input.enabled,
      provider,
      modes,
      cnameTarget,
      apexAddresses,
      nameservers,
      soaEmail,
      includeWww: input.includeWww,
      redirectToPrimary: input.redirectToPrimary,
      pendingExpiryDays: intIn(input.pendingExpiryDays, 1, 90, 7),
      failureThreshold: intIn(input.failureThreshold, 1, 50, 3),
      upgradeUrl,
      bunny: { pullZoneId, apiKeyCiphertext },
    },
  };
}

export async function readDomainSettings(): Promise<StoredDomainSettings> {
  try {
    const db = await getControlDb();
    const rows = await db.query<{ value: unknown }>(
      "SELECT value FROM platform_settings WHERE setting_key = ? LIMIT 1",
      [SETTING_KEY],
    );
    return parseStoredDomainSettings(rows[0]?.value);
  } catch {
    return defaultDomainSettings();
  }
}

let cached: { at: number; value: StoredDomainSettings } | null = null;

/** Per-request reads (the primary-domain redirect) use a copy at most 30 seconds old. */
export async function cachedDomainSettings(): Promise<StoredDomainSettings> {
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  const value = await readDomainSettings();
  cached = { at: Date.now(), value };
  return value;
}

export async function writeDomainSettings(stored: StoredDomainSettings): Promise<void> {
  cached = null;
  const db = await getControlDb();
  const stamp = new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
  if (process.env.DB_DRIVER === "postgres") {
    // Bind the object: a JSON string next to ::jsonb is stored as a JSON string.
    await db.run(
      `INSERT INTO platform_settings (setting_key, value, updated_at) VALUES (?, ?::jsonb, ?)
       ON CONFLICT (setting_key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [SETTING_KEY, stored as unknown as string, stamp],
    );
    return;
  }
  await db.run(
    `INSERT INTO platform_settings (setting_key, value, updated_at) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`,
    [SETTING_KEY, JSON.stringify(stored), stamp],
  );
}

/** The decrypted Bunny key: this page's own, or the one saved under Settings → CDN. */
export async function bunnyApiKey(stored: StoredDomainSettings): Promise<string> {
  const own = stored.bunny.apiKeyCiphertext ? decryptSecret(stored.bunny.apiKeyCiphertext) : "";
  if (own) return own;
  try {
    const { loadActiveCdn } = await import("../cdn/cdn-settings.js");
    const cdn = await loadActiveCdn(null);
    if (cdn?.adapter.id === "bunny" && cdn.config.apiKey) return cdn.config.apiKey;
  } catch {
    // No CDN connection.
  }
  return "";
}

export type { StoredDomainSettings };
