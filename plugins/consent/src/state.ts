import type { PluginContext } from "@justflows/sdk";
import { DEFAULT_CONFIG, loadConfig, type ConsentConfig } from "./config.js";

/**
 * A synchronous snapshot of the plugin config. `html.head` and `analytics.head`
 * run on the render path and cannot await a `plugin_data` read, so the config is
 * loaded once on activation and refreshed whenever the admin saves it (same
 * process, same plugin instance).
 */
let cache: ConsentConfig = DEFAULT_CONFIG;

export function getCachedConfig(): ConsentConfig {
  return cache;
}

export function setCachedConfig(next: ConsentConfig): void {
  cache = next;
}

export async function refreshConfig(ctx: Pick<PluginContext, "settings">): Promise<ConsentConfig> {
  cache = await loadConfig(ctx);
  return cache;
}

/** Best-effort site hostname for deciding which iframes are "off-site". */
export function siteHost(): string {
  try {
    return new URL(process.env["APP_URL"] ?? "").hostname.toLowerCase();
  } catch {
    return "";
  }
}
