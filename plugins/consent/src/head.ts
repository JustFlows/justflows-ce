import { gateSnippet } from "./gating.js";
import { publicConfig, type ConsentConfig } from "./config.js";
import { COOKIES_PATH, RECORD_PATH, RUNTIME_PATH } from "./http.js";

/** Serialize the public config for a `<script type="application/json">` island
 * that cannot break out of its element. */
function jsonIsland(id: string, value: unknown): string {
  const json = JSON.stringify(value).replace(/</g, "\\u003c");
  return `<script type="application/json" id="${id}">${json}</script>`;
}

/**
 * The `<head>` markup the plugin appends via the `html.head` filter:
 *   1. the config island the runtime reads,
 *   2. operator analytics/marketing snippets, pre-gated and inert,
 *   3. the async runtime that renders the banner and unlocks categories.
 * Returns `""` when the plugin is disabled or display mode is `off`.
 */
export function buildHeadHtml(config: ConsentConfig): string {
  if (!config.enabled || config.displayMode === "off") return "";

  const parts = [
    jsonIsland("jf-consent-config", publicConfig(config, RECORD_PATH, COOKIES_PATH)),
  ];

  const analytics = gateSnippet(config.analyticsSnippet, "analytics");
  if (analytics) parts.push(analytics);
  const marketing = gateSnippet(config.marketingSnippet, "marketing");
  if (marketing) parts.push(marketing);

  parts.push(`<script src="${RUNTIME_PATH}" async></script>`);
  return parts.join("\n");
}
