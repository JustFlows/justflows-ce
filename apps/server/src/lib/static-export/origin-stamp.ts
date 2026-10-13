// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";

/**
 * The inline `window.__JF_ORIGIN__` script stamped into every exported page.
 * `JSON.stringify` does not escape `<` / `/`, so an origin containing
 * `</script>` would close the tag early. Escape `<` for the inline script.
 */
export function originStampScript(originUrl: string): string {
  return `window.__JF_ORIGIN__=${JSON.stringify(originUrl).replace(/</g, "\\u003c")};`;
}

/**
 * Allow exactly the stamp script in a `script-src` that blocks inline scripts.
 * A policy with `'unsafe-inline'` is left alone (a hash would switch it off),
 * and a policy without `script-src` / `default-src` already allows it.
 */
export function withOriginStampCsp(csp: string, originUrl: string): string {
  const parts = csp.split(";").map((part) => part.trim()).filter(Boolean);
  const directive = (name: string) => parts.findIndex((part) => part.split(/\s+/)[0]?.toLowerCase() === name);
  const hash = `'sha256-${createHash("sha256").update(originStampScript(originUrl), "utf8").digest("base64")}'`;
  const scriptIndex = directive("script-src");
  if (scriptIndex >= 0) {
    const sources = parts[scriptIndex]!.split(/\s+/).slice(1);
    if (sources.includes("'unsafe-inline'") || sources.includes(hash)) return csp;
    parts[scriptIndex] = `${parts[scriptIndex]} ${hash}`;
    return parts.join("; ");
  }
  const defaultIndex = directive("default-src");
  if (defaultIndex < 0) return csp;
  const fallback = parts[defaultIndex]!.split(/\s+/).slice(1);
  if (fallback.includes("'unsafe-inline'")) return csp;
  parts.push(["script-src", ...fallback.filter((source) => source !== "'none'"), hash].join(" "));
  return parts.join("; ");
}
