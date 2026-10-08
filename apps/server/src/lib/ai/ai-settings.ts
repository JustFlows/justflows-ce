// SPDX-License-Identifier: MIT

import type { Request } from "express";
import { getTenantContext } from "../tenancy/context.js";
import { isInstallationRootRequest } from "../tenancy/access.js";
import { getSiteId, getSiteSetting, setSiteSetting } from "../settings/site-settings.js";
import { getManageApiRateLimit, isManageApiEnabled } from "../http/manage-api-settings.js";

/**
 * Site settings for bring-your-own-AI (#159). Every value is read per request,
 * so a change takes effect without a restart, and every read fails closed.
 *
 * - `mcp_enabled` — the MCP server at `/api/mcp`. Off by default, and it also
 *   requires the management API master switch (`manage_api_enabled`).
 * - `ai_assistant_enabled` — the in-admin assistant. Off by default.
 * - `ai_allow_private_endpoints` — lets an administrator point an
 *   OpenAI-compatible provider at a private or loopback address (a local
 *   Ollama or LM Studio). Never applies to `media_upload` source URLs. This
 *   is installation network policy, so only the root site can turn it on; on
 *   any other site the effective value is always false.
 * - `ai_user_daily_limit` — optional assistant requests per user per day.
 * - `mcp_rate_limit` — per-minute MCP ceiling per key/token and per IP; falls
 *   back to `manage_api_rate_limit`.
 */

export interface AiSettings {
  mcpEnabled: boolean;
  assistantEnabled: boolean;
  allowPrivateEndpoints: boolean;
  /** null means unlimited. */
  userDailyLimit: number | null;
  /** null means "use the management API limit". */
  mcpRateLimit: number | null;
}

async function readBoolean(key: string): Promise<boolean> {
  try {
    const siteId = await getSiteId();
    if (!siteId) return false;
    return (await getSiteSetting<boolean>(siteId, key)) === true;
  } catch {
    return false;
  }
}

async function readPositiveInt(key: string): Promise<number | null> {
  try {
    const siteId = await getSiteId();
    if (!siteId) return null;
    const value = await getSiteSetting<number>(siteId, key);
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.min(Math.floor(value), 100_000);
    }
    return null;
  } catch {
    return null;
  }
}

/** MCP is served only when both its own switch and the management API are on. */
export async function isMcpEnabled(): Promise<boolean> {
  const [mcp, manage] = await Promise.all([readBoolean("mcp_enabled"), isManageApiEnabled()]);
  return mcp && manage;
}

export async function isAssistantEnabled(): Promise<boolean> {
  return readBoolean("ai_assistant_enabled");
}

export async function allowPrivateAiEndpoints(): Promise<boolean> {
  if (!isInstallationRootRequest()) return false;
  return readBoolean("ai_allow_private_endpoints");
}

export async function getAiUserDailyLimit(): Promise<number | null> {
  return readPositiveInt("ai_user_daily_limit");
}

export async function getMcpRateLimit(): Promise<number> {
  return (await readPositiveInt("mcp_rate_limit")) ?? (await getManageApiRateLimit());
}

export async function getAiSettings(): Promise<AiSettings> {
  const [mcpEnabled, assistantEnabled, allowPrivateEndpoints, userDailyLimit, mcpRateLimit] =
    await Promise.all([
      readBoolean("mcp_enabled"),
      isAssistantEnabled(),
      allowPrivateAiEndpoints(),
      getAiUserDailyLimit(),
      readPositiveInt("mcp_rate_limit"),
    ]);
  return { mcpEnabled, assistantEnabled, allowPrivateEndpoints, userDailyLimit, mcpRateLimit };
}

export class AiSettingsError extends Error {}

export async function saveAiSettings(patch: Partial<AiSettings>): Promise<AiSettings> {
  const siteId = await getSiteId();
  if (!siteId) throw new Error("Site is not installed");
  if (patch.mcpEnabled !== undefined) await setSiteSetting(siteId, "mcp_enabled", patch.mcpEnabled === true);
  if (patch.assistantEnabled !== undefined) {
    await setSiteSetting(siteId, "ai_assistant_enabled", patch.assistantEnabled === true);
  }
  if (patch.allowPrivateEndpoints !== undefined) {
    if (patch.allowPrivateEndpoints === true && !isInstallationRootRequest()) {
      throw new AiSettingsError("Private provider addresses can only be allowed on the main site.");
    }
    await setSiteSetting(siteId, "ai_allow_private_endpoints", patch.allowPrivateEndpoints === true);
  }
  if (patch.userDailyLimit !== undefined) {
    await setSiteSetting(
      siteId,
      "ai_user_daily_limit",
      patch.userDailyLimit && patch.userDailyLimit > 0 ? Math.min(Math.floor(patch.userDailyLimit), 100_000) : null,
    );
  }
  if (patch.mcpRateLimit !== undefined) {
    await setSiteSetting(
      siteId,
      "mcp_rate_limit",
      patch.mcpRateLimit && patch.mcpRateLimit > 0 ? Math.min(Math.floor(patch.mcpRateLimit), 100_000) : null,
    );
  }
  return getAiSettings();
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/**
 * The public origin the MCP resource and OAuth issuer are advertised under.
 *
 * On a multisite request this is the site being served, so an agent for one
 * website is bound to that hostname and cannot be reused on another. A
 * single-site install keeps `APP_URL` when it names a real host; a loopback
 * `APP_URL` falls back to the request origin. The request origin relies on
 * `trust proxy` for the scheme.
 */
export function publicOrigin(req: Pick<Request, "protocol" | "get">): string {
  const siteHost = getTenantContext()?.hostname?.trim().toLowerCase();
  if (siteHost && !LOOPBACK_HOSTS.has(siteHost)) {
    return `${req.protocol}://${siteHost}`;
  }
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if ((url.protocol === "https:" || url.protocol === "http:") && !LOOPBACK_HOSTS.has(url.hostname)) {
        return url.origin;
      }
    } catch {
      // Fall through to the request origin.
    }
  }
  return `${req.protocol}://${req.get("host") ?? "localhost"}`;
}

/** The MCP endpoint's canonical URL, which OAuth tokens are bound to. */
export function mcpResourceUrl(req: Pick<Request, "protocol" | "get">): string {
  return `${publicOrigin(req)}/api/mcp`;
}

/** Whether hosted connectors (claude.ai, ChatGPT) can reach this origin. */
export function isPublicHttpsOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    if (/^(10|127)\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}
