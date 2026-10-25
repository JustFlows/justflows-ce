// SPDX-License-Identifier: MIT

import type { CspSourceContribution } from "@justflows/sdk";

const DIRECTIVES = [
  "script-src",
  "script-src-elem",
  "style-src",
  "img-src",
  "font-src",
  "connect-src",
  "frame-src",
  "media-src",
  "worker-src",
  "form-action",
] as const satisfies readonly (keyof CspSourceContribution)[];

/**
 * A plugin may name an https origin, or one leftmost wildcard label
 * (`https://*.stripe.com`). Keywords, paths, and any other scheme are refused.
 */
export function isPluginCspSource(source: string): boolean {
  if (!source.startsWith("https://")) return false;
  const host = source.slice("https://".length);
  const name = host.startsWith("*.") ? host.slice(2) : host;
  if (!name || name.includes("*") || name.includes("/") || name.includes("@") || name.includes(":")) return false;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(name);
}

function sourcesFor(contribution: CspSourceContribution, directive: (typeof DIRECTIVES)[number]): string[] {
  const raw = contribution[directive];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const source of raw) {
    if (typeof source === "string" && isPluginCspSource(source) && !out.includes(source)) out.push(source);
  }
  return out;
}

/**
 * Append plugin-supplied hosts to a Content-Security-Policy.
 * A directive that is `'none'` stays closed. A missing directive is added as
 * `'self'` plus the new hosts, which is what `default-src 'self'` already allowed.
 */
export function applyCspSources(csp: string, contribution: CspSourceContribution): string {
  const parts = csp.split(";").map((part) => part.trim()).filter(Boolean);
  const order: string[] = [];
  const byName = new Map<string, string[]>();
  for (const part of parts) {
    const [name, ...rest] = part.split(/\s+/);
    if (!name) continue;
    const key = name.toLowerCase();
    if (!byName.has(key)) order.push(key);
    byName.set(key, [...(byName.get(key) ?? []), ...rest]);
  }

  for (const directive of DIRECTIVES) {
    const extra = sourcesFor(contribution, directive);
    if (!extra.length) continue;
    const existing = byName.get(directive);
    if (existing?.some((source) => source.toLowerCase() === "'none'")) continue;
    const next = [...(existing ?? ["'self'"])];
    for (const source of extra) {
      if (!next.some((item) => item.toLowerCase() === source.toLowerCase())) next.push(source);
    }
    if (!existing) order.push(directive);
    byName.set(directive, next);
  }

  return order.map((key) => [key, ...(byName.get(key) ?? [])].join(" ")).join("; ");
}
