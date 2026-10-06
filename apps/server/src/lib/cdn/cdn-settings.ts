// SPDX-License-Identifier: MIT

import { getControlDb } from "../database/db.js";
import { deleteSiteSetting, getSiteId, getSiteSetting, parseSettingValue, setSiteSetting, settingsKeyColumn } from "../settings/site-settings.js";
import { decryptSecret, encryptSecret } from "../security/secret-box.js";
import { getTenantContext } from "../tenancy/context.js";
import {
  getCdnAdapter,
  isCdnProviderId,
  type CdnConfig,
  type CdnProviderAdapter,
  type CdnProviderId,
} from "./providers/index.js";

/**
 * The CDN connection the installation purges after revalidation.
 *
 * It is saved on the platform site only, in `site_settings` under `cdn_provider`.
 * Secret fields are encrypted with secret-box and write-only: the browser sees
 * their last four characters, never the value. A customer site does not store
 * its own connection. It purges its hostnames through this one, or through the
 * installation-wide `BUNNY_API_KEY` / `BUNNY_PULL_ZONE_ID` when nothing is saved.
 */

const SETTING_KEY = "cdn_provider";

interface StoredConnection {
  provider: CdnProviderId;
  enabled: boolean;
  values: Record<string, string>;
  /** Encrypted secret values by field id. */
  secrets: Record<string, string>;
  last4: Record<string, string>;
  updatedAt: string;
}

export interface CdnConnectionView {
  provider: CdnProviderId;
  enabled: boolean;
  /** Non-secret field values. */
  values: Record<string, string>;
  /** Secret fields that are set, with their last four characters. */
  secrets: Record<string, { last4: string }>;
  updatedAt: string;
}

export interface CdnSettingsView {
  connection: CdnConnectionView | null;
  /** The installation's environment configures a CDN this site falls back to. */
  environmentFallback: boolean;
}

export interface ActiveCdn {
  adapter: CdnProviderAdapter;
  config: CdnConfig;
  source: "site" | "environment";
}

export class CdnSettingsError extends Error {}

function isStored(value: unknown): value is StoredConnection {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<StoredConnection>;
  return isCdnProviderId(row.provider) && typeof row.values === "object" && typeof row.secrets === "object";
}

async function readStored(siteId: string): Promise<StoredConnection | null> {
  const value = await getSiteSetting<unknown>(siteId, SETTING_KEY);
  return isStored(value) ? value : null;
}

function toView(stored: StoredConnection): CdnConnectionView {
  const secrets: CdnConnectionView["secrets"] = {};
  for (const field of getCdnAdapter(stored.provider).fields) {
    if (field.secret && stored.secrets[field.id]) secrets[field.id] = { last4: stored.last4?.[field.id] ?? "" };
  }
  return {
    provider: stored.provider,
    enabled: stored.enabled !== false,
    values: { ...stored.values },
    secrets,
    updatedAt: stored.updatedAt,
  };
}

function environmentConfig(): CdnConfig | null {
  const apiKey = process.env.BUNNY_API_KEY?.trim() ?? "";
  if (!apiKey) return null;
  return { apiKey, pullZoneId: process.env.BUNNY_PULL_ZONE_ID?.trim() ?? "" };
}

export async function getCdnSettings(siteId: string): Promise<CdnSettingsView> {
  const stored = await readStored(siteId);
  return { connection: stored ? toView(stored) : null, environmentFallback: environmentConfig() !== null };
}

export interface SaveCdnInput {
  provider: CdnProviderId;
  enabled?: boolean;
  /**
   * Field values by id. For a secret field, an empty or missing value keeps
   * the stored one (same provider only); `null` clears an optional field.
   */
  values: Record<string, string | null | undefined>;
}

export async function saveCdnSettings(
  siteId: string,
  input: SaveCdnInput,
): Promise<{ connection: CdnConnectionView; secretsReplaced: string[] }> {
  const adapter = getCdnAdapter(input.provider);
  const existing = await readStored(siteId);
  const previous = existing?.provider === input.provider ? existing : null;

  const next: StoredConnection = {
    provider: input.provider,
    enabled: input.enabled ?? previous?.enabled ?? true,
    values: {},
    secrets: {},
    last4: {},
    updatedAt: new Date().toISOString(),
  };
  const secretsReplaced: string[] = [];

  for (const field of adapter.fields) {
    const raw = input.values[field.id];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value) {
      if (value.length > field.maxLength || (field.pattern && !field.pattern.test(value))) {
        throw new CdnSettingsError(`${field.label} is not valid.`);
      }
      if (field.secret) {
        next.secrets[field.id] = encryptSecret(value);
        next.last4[field.id] = value.slice(-4);
        secretsReplaced.push(field.id);
      } else {
        next.values[field.id] = value;
      }
    } else if (field.secret && raw !== null && previous?.secrets[field.id]) {
      next.secrets[field.id] = previous.secrets[field.id]!;
      next.last4[field.id] = previous.last4?.[field.id] ?? "";
    } else if (!field.secret && raw === undefined && previous?.values[field.id]) {
      next.values[field.id] = previous.values[field.id]!;
    }

    const present = field.secret ? Boolean(next.secrets[field.id]) : Boolean(next.values[field.id]);
    if (field.required && !present) throw new CdnSettingsError(`${field.label} is required.`);
  }

  await setSiteSetting(siteId, SETTING_KEY, next);
  return { connection: toView(next), secretsReplaced };
}

export async function deleteCdnSettings(siteId: string): Promise<boolean> {
  if (!(await readStored(siteId))) return false;
  await deleteSiteSetting(siteId, SETTING_KEY);
  return true;
}

/** Server-only: the decrypted config of the site's own connection, enabled or not. */
export async function loadSiteCdn(siteId: string): Promise<ActiveCdn | null> {
  const stored = await readStored(siteId);
  if (!stored) return null;
  const adapter = getCdnAdapter(stored.provider);
  const config: CdnConfig = { ...stored.values };
  for (const field of adapter.fields) {
    if (!field.secret) continue;
    const value = decryptSecret(stored.secrets[field.id]);
    if (!value && field.required) return null;
    if (value) config[field.id] = value;
  }
  return { adapter, config, source: "site" };
}

/** The installation's first site. Its database holds the CDN connection. */
async function installationRootSiteId(): Promise<string | null> {
  try {
    const db = await getControlDb();
    const rows = await db.query<{ id: string }>(
      "SELECT id FROM sites WHERE status <> 'deleted' ORDER BY created_at ASC, id ASC LIMIT 1",
    );
    return rows[0] ? String(rows[0].id) : null;
  } catch {
    return null;
  }
}

async function readStoredOnControl(siteId: string): Promise<StoredConnection | null> {
  const db = await getControlDb();
  const rows = await db.query<{ value: unknown }>(
    `SELECT value FROM site_settings WHERE site_id = ? AND ${settingsKeyColumn()} = ? LIMIT 1`,
    [siteId, SETTING_KEY],
  );
  const value = parseSettingValue<unknown>(rows.length > 0, rows[0]?.value);
  return isStored(value) ? value : null;
}

function activeFrom(stored: StoredConnection): ActiveCdn | null {
  const adapter = getCdnAdapter(stored.provider);
  const config: CdnConfig = { ...stored.values };
  for (const field of adapter.fields) {
    if (!field.secret) continue;
    const value = decryptSecret(stored.secrets[field.id]);
    if (!value && field.required) return null;
    if (value) config[field.id] = value;
  }
  return { adapter, config, source: "site" };
}

/**
 * The CDN used to purge a site. The platform site uses the connection saved
 * there. A customer site uses that same connection, read from the installation
 * database, and never one saved on the customer site. The environment is the
 * fallback. Null when neither is configured.
 */
export async function loadActiveCdn(siteId?: string | null): Promise<ActiveCdn | null> {
  try {
    const id = siteId ?? getTenantContext()?.siteId ?? (await getSiteId());
    const rootId = await installationRootSiteId();
    const onRoot = !id || !rootId || id === rootId;
    if (onRoot && id) {
      const stored = await readStored(id);
      if (stored && stored.enabled !== false) {
        const own = await loadSiteCdn(id);
        if (own) return own;
      }
    } else if (rootId) {
      const stored = await readStoredOnControl(rootId);
      if (stored && stored.enabled !== false) {
        const shared = activeFrom(stored);
        if (shared) return shared;
      }
    }
  } catch (err) {
    console.error("[cdn] could not read the CDN settings:", err instanceof Error ? err.message : "unknown error");
  }
  const env = environmentConfig();
  return env ? { adapter: getCdnAdapter("bunny"), config: env, source: "environment" } : null;
}
