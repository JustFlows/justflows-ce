// SPDX-License-Identifier: MIT

import { getSiteId, getSiteSetting, setSiteSetting } from "./site-settings.js";
import { isPublicApiEnabled } from "./public-api-access.js";

/**
 * The two HTTP-API switches, surfaced together on Admin → Settings → API.
 *
 * - `public_api_enabled` — the read-only public content API (`/api/v1`,
 *   `/api/site`). Off by default; when off those routes answer 404 to
 *   anonymous callers. Owned by the settings service; mirrored here so the API
 *   page can read and toggle it alongside the management switch.
 * - `manage_api_enabled` — master switch for the federated management API
 *   (#135). Off by default; when off, every key-authenticated request is
 *   refused regardless of the key. Checked per request, so toggling it takes
 *   effect without a restart.
 * - `manage_api_rate_limit` — default per-minute ceiling applied per key and
 *   per IP when a key does not set its own `rateLimitPerMin`.
 * - `manage_api_allowed_origins` — browser origins allowed to call the
 *   management API with CORS in addition to any a key lists. Server-to-server
 *   clients need none of this.
 */

export const MANAGE_API_DEFAULT_RATE_LIMIT = 120;

export async function isManageApiEnabled(): Promise<boolean> {
  try {
    const siteId = await getSiteId();
    if (!siteId) return false;
    return (await getSiteSetting<boolean>(siteId, "manage_api_enabled")) === true;
  } catch {
    // Fail closed: never expose the management API when the setting cannot be read.
    return false;
  }
}

export async function getManageApiRateLimit(): Promise<number> {
  try {
    const siteId = await getSiteId();
    if (!siteId) return MANAGE_API_DEFAULT_RATE_LIMIT;
    const value = await getSiteSetting<number>(siteId, "manage_api_rate_limit");
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.min(Math.floor(value), 100_000);
    }
    return MANAGE_API_DEFAULT_RATE_LIMIT;
  } catch {
    return MANAGE_API_DEFAULT_RATE_LIMIT;
  }
}

export async function getManageApiAllowedOrigins(): Promise<string[]> {
  try {
    const siteId = await getSiteId();
    if (!siteId) return [];
    const value = await getSiteSetting<unknown>(siteId, "manage_api_allowed_origins");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

export interface ManageApiSettings {
  /** The read-only public content API switch (`/api/v1`, `/api/site`). */
  publicApiEnabled: boolean;
  /** The federated management API master switch (`/api/manage/v1`). */
  enabled: boolean;
  rateLimitPerMin: number;
  allowedOrigins: string[];
}

export async function getManageApiSettings(): Promise<ManageApiSettings> {
  const [publicApiEnabled, enabled, rateLimitPerMin, allowedOrigins] = await Promise.all([
    isPublicApiEnabled(),
    isManageApiEnabled(),
    getManageApiRateLimit(),
    getManageApiAllowedOrigins(),
  ]);
  return { publicApiEnabled, enabled, rateLimitPerMin, allowedOrigins };
}

export async function saveManageApiSettings(patch: Partial<ManageApiSettings>): Promise<ManageApiSettings> {
  const siteId = await getSiteId();
  if (!siteId) throw new Error("Site is not installed");
  if (patch.publicApiEnabled !== undefined) {
    await setSiteSetting(siteId, "public_api_enabled", patch.publicApiEnabled === true);
  }
  if (patch.enabled !== undefined) {
    await setSiteSetting(siteId, "manage_api_enabled", patch.enabled === true);
  }
  if (patch.rateLimitPerMin !== undefined) {
    const value = Math.max(1, Math.min(Math.floor(patch.rateLimitPerMin), 100_000));
    await setSiteSetting(siteId, "manage_api_rate_limit", value);
  }
  if (patch.allowedOrigins !== undefined) {
    const list = [
      ...new Set(
        (patch.allowedOrigins ?? [])
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ].slice(0, 50);
    await setSiteSetting(siteId, "manage_api_allowed_origins", list);
  }
  return getManageApiSettings();
}
