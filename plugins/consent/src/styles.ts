import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { PluginContext } from "@justflows/sdk";
import { getCachedConfig } from "./state.js";

const MARKER = "/* justflows.consent */";
let cachedCss: string | undefined;

/** Append the consent banner / preference-center stylesheet to `/theme.css`,
 * but only while the plugin is enabled. Toggling `enabled` takes effect on the
 * next `/theme.css` build. */
export async function registerConsentStyles(ctx: PluginContext): Promise<void> {
  cachedCss ??= (
    await readFile(fileURLToPath(new URL("./styles/consent.css", import.meta.url)), "utf8")
  ).trim();

  ctx.hooks.filter("theme.css", (current) => {
    if (!getCachedConfig().enabled || current.includes(MARKER)) return current;
    return `${current}\n${MARKER}\n${cachedCss}\n`;
  });
}
