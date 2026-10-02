// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import { getDb } from "../database/db.js";
import { decryptSecret, encryptSecret } from "../security/secret-box.js";
import { allowPrivateAiEndpoints } from "./ai-settings.js";
import { assertOutboundUrl, OutboundUrlError } from "./safe-fetch.js";
import { getProviderAdapter, PROVIDER_IDS, type ProviderConfig, type ProviderId } from "./providers/index.js";

/**
 * Stored AI provider credentials (#159).
 *
 * Keys are encrypted at rest with secret-box and are write-only: nothing here
 * returns a key except `loadProviderConfig`, which the server uses to call the
 * provider and which never leaves the process. The UI sees only the provider,
 * the last four characters, and the non-secret settings.
 *
 * A credential is either site-wide (`scope_key = 'site'`, managed with
 * settings:manage, used by every user with ai:use) or personal
 * (`scope_key = 'user:<id>'`), which takes precedence for its owner.
 */

export type CredentialScope = { kind: "site" } | { kind: "user"; userId: string };

export interface ProviderCredential {
  provider: ProviderId;
  scope: "site" | "personal";
  label: string | null;
  keyLast4: string;
  baseUrl: string | null;
  organization: string | null;
  project: string | null;
  models: string[];
  defaultModel: string | null;
  enabled: boolean;
  updatedAt: string | null;
}

export class CredentialError extends Error {}

function scopeKey(scope: CredentialScope): string {
  return scope.kind === "site" ? "site" : `user:${scope.userId}`;
}

function sqlTime(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

function parseModels(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 500) : [];
  } catch {
    return [];
  }
}

function rowToCredential(row: Record<string, unknown>): ProviderCredential {
  return {
    provider: String(row.provider) as ProviderId,
    scope: String(row.scope_key) === "site" ? "site" : "personal",
    label: row.label == null ? null : String(row.label),
    keyLast4: String(row.key_last4 ?? ""),
    baseUrl: row.base_url == null ? null : String(row.base_url),
    organization: row.organization == null ? null : String(row.organization),
    project: row.project == null ? null : String(row.project),
    models: parseModels(row.models_json),
    defaultModel: row.default_model == null ? null : String(row.default_model),
    enabled: row.enabled === true || Number(row.enabled) === 1,
    updatedAt: row.updated_at == null ? null : String(row.updated_at),
  };
}

const PUBLIC_COLUMNS =
  "provider, scope_key, label, key_last4, base_url, organization, project, models_json, default_model, enabled, updated_at";

export async function listCredentials(siteId: string, scope: CredentialScope): Promise<ProviderCredential[]> {
  const rows = await (
    await getDb()
  ).query<Record<string, unknown>>(
    `SELECT ${PUBLIC_COLUMNS} FROM ai_provider_credentials WHERE site_id = ? AND scope_key = ? ORDER BY provider`,
    [siteId, scopeKey(scope)],
  );
  return rows.map(rowToCredential);
}

async function getRow(siteId: string, scope: CredentialScope, provider: ProviderId) {
  const rows = await (
    await getDb()
  ).query<Record<string, unknown>>(
    "SELECT * FROM ai_provider_credentials WHERE site_id = ? AND scope_key = ? AND provider = ? LIMIT 1",
    [siteId, scopeKey(scope), provider],
  );
  return rows[0] ?? null;
}

/**
 * A base URL is checked against the SSRF guard when saved and again on every
 * call. Private addresses are allowed only for site-wide credentials and only
 * while the administrator has turned on `ai_allow_private_endpoints` — a
 * personal key must never let a user aim the server at its own network.
 */
export async function privateAllowedFor(scope: CredentialScope): Promise<boolean> {
  return scope.kind === "site" && (await allowPrivateAiEndpoints());
}

async function normalizeBaseUrl(value: string | null | undefined, scope: CredentialScope): Promise<string | null> {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = await assertOutboundUrl(trimmed, await privateAllowedFor(scope));
    return url.toString().replace(/\/+$/, "").slice(0, 500);
  } catch (err) {
    throw new CredentialError(err instanceof OutboundUrlError ? `Base URL: ${err.message}` : "Base URL is not valid");
  }
}

export interface SaveCredentialInput {
  siteId: string;
  scope: CredentialScope;
  provider: ProviderId;
  /** Omit to keep the stored key. */
  apiKey?: string;
  label?: string | null;
  baseUrl?: string | null;
  organization?: string | null;
  project?: string | null;
  models?: string[];
  defaultModel?: string | null;
  enabled?: boolean;
  actorId: string;
}

export async function saveCredential(input: SaveCredentialInput): Promise<{ credential: ProviderCredential; keyReplaced: boolean }> {
  const existing = await getRow(input.siteId, input.scope, input.provider);
  const apiKey = input.apiKey?.trim();
  if (!existing && !apiKey) throw new CredentialError("An API key is required.");
  if (apiKey !== undefined && (apiKey.length < 8 || apiKey.length > 500 || /\s/.test(apiKey))) {
    throw new CredentialError("That does not look like an API key.");
  }
  const baseUrl =
    input.baseUrl !== undefined
      ? await normalizeBaseUrl(input.baseUrl, input.scope)
      : existing?.base_url == null
        ? null
        : String(existing.base_url);
  if (input.provider === "openai-compatible" && !baseUrl) {
    throw new CredentialError("An OpenAI-compatible provider needs a base URL.");
  }
  const clean = (value: string | null | undefined, max: number) => (value?.trim() ? value.trim().slice(0, max) : null);
  const models = (input.models ?? (existing ? parseModels(existing.models_json) : []))
    .filter((model) => typeof model === "string" && model.length <= 200)
    .slice(0, 500);
  const defaultModel =
    input.defaultModel !== undefined ? clean(input.defaultModel, 200) : existing?.default_model == null ? null : String(existing.default_model);
  const enabled = input.enabled ?? (existing ? existing.enabled === true || Number(existing.enabled) === 1 : true);
  const db = await getDb();
  const now = sqlTime();

  if (existing) {
    const sets = [
      "label = ?",
      "base_url = ?",
      "organization = ?",
      "project = ?",
      "models_json = ?",
      "default_model = ?",
      "enabled = ?",
      "updated_at = ?",
    ];
    const params: (string | boolean | null)[] = [
      input.label !== undefined ? clean(input.label, 120) : (existing.label as string | null),
      baseUrl,
      input.organization !== undefined ? clean(input.organization, 120) : (existing.organization as string | null),
      input.project !== undefined ? clean(input.project, 120) : (existing.project as string | null),
      JSON.stringify(models),
      defaultModel,
      enabled,
      now,
    ];
    if (apiKey) {
      sets.push("api_key_enc = ?", "key_last4 = ?");
      params.push(encryptSecret(apiKey), apiKey.slice(-4));
    }
    params.push(String(existing.id));
    await db.run(`UPDATE ai_provider_credentials SET ${sets.join(", ")} WHERE id = ?`, params);
  } else {
    await db.run(
      `INSERT INTO ai_provider_credentials
         (id, site_id, user_id, scope_key, provider, label, api_key_enc, key_last4, base_url, organization, project,
          models_json, default_model, enabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.siteId,
        input.scope.kind === "user" ? input.scope.userId : null,
        scopeKey(input.scope),
        input.provider,
        clean(input.label, 120),
        encryptSecret(apiKey!),
        apiKey!.slice(-4),
        baseUrl,
        clean(input.organization, 120),
        clean(input.project, 120),
        JSON.stringify(models),
        defaultModel,
        enabled,
        input.actorId,
        now,
        now,
      ],
    );
  }
  const saved = await getRow(input.siteId, input.scope, input.provider);
  return { credential: rowToCredential(saved!), keyReplaced: Boolean(apiKey) };
}

export async function deleteCredential(siteId: string, scope: CredentialScope, provider: ProviderId): Promise<boolean> {
  const existing = await getRow(siteId, scope, provider);
  if (!existing) return false;
  await (await getDb()).run("DELETE FROM ai_provider_credentials WHERE id = ?", [String(existing.id)]);
  return true;
}

/** Server-only: the decrypted config for one stored credential. */
export async function loadProviderConfig(
  siteId: string,
  scope: CredentialScope,
  provider: ProviderId,
): Promise<ProviderConfig | null> {
  const row = await getRow(siteId, scope, provider);
  if (!row) return null;
  const apiKey = decryptSecret(row.api_key_enc);
  if (!apiKey) return null;
  return {
    provider,
    apiKey,
    baseUrl: row.base_url == null ? null : String(row.base_url),
    organization: row.organization == null ? null : String(row.organization),
    project: row.project == null ? null : String(row.project),
    allowPrivate: await privateAllowedFor(scope),
  };
}

/** Models offered by one stored credential, fetched from the provider. */
export async function fetchModels(config: ProviderConfig): Promise<string[]> {
  return (await getProviderAdapter(config.provider).listModels(config)).slice(0, 500);
}

export interface AvailableProvider {
  source: "site" | "personal";
  provider: ProviderId;
  label: string | null;
  models: string[];
  defaultModel: string | null;
}

/**
 * The providers a user can chat with. A personal key replaces the site key
 * for the same provider; site keys are only offered to users with ai:use (the
 * caller checks that).
 */
export async function availableProviders(siteId: string, userId: string): Promise<AvailableProvider[]> {
  const [personal, site] = await Promise.all([
    listCredentials(siteId, { kind: "user", userId }),
    listCredentials(siteId, { kind: "site" }),
  ]);
  const byProvider = new Map<ProviderId, AvailableProvider>();
  for (const credential of site.filter((item) => item.enabled)) {
    byProvider.set(credential.provider, { source: "site", provider: credential.provider, label: credential.label, models: credential.models, defaultModel: credential.defaultModel });
  }
  for (const credential of personal.filter((item) => item.enabled)) {
    byProvider.set(credential.provider, { source: "personal", provider: credential.provider, label: credential.label, models: credential.models, defaultModel: credential.defaultModel });
  }
  // Personal keys first, so the assistant defaults to the user's own.
  return [...byProvider.values()].sort((a, b) => (a.source === b.source ? 0 : a.source === "personal" ? -1 : 1));
}

export function scopeFor(source: "site" | "personal", userId: string): CredentialScope {
  return source === "site" ? { kind: "site" } : { kind: "user", userId };
}
