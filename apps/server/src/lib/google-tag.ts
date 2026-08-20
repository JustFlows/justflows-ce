// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";

const GOOGLE_TAG_RE = /\b((?:GTM|GT|AW|DC|G)-[A-Z0-9]+)\b/i;

/** Accept a raw ID or a pasted Google snippet and return a safe tag ID. */
export function parseGoogleTagId(raw: string): string | null {
  const match = raw.trim().match(GOOGLE_TAG_RE);
  if (!match?.[1]) return null;
  return match[1].toUpperCase();
}

function gtmLoaderScript(tag: string): string {
  return `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${tag}');`;
}

function gtagConfigScript(tag: string): string {
  return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${tag}');`;
}

function sha256Csp(source: string): string {
  return `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`;
}

export function googleTagInlineHashes(id: string): string[] {
  const tag = parseGoogleTagId(id);
  if (!tag) return [];
  if (tag.startsWith("GTM-")) return [sha256Csp(gtmLoaderScript(tag))];
  return [sha256Csp(gtagConfigScript(tag))];
}

export function buildGoogleTagHead(id: string): string {
  const tag = parseGoogleTagId(id);
  if (!tag) return "";
  if (tag.startsWith("GTM-")) {
    return `<script>${gtmLoaderScript(tag)}</script>`;
  }
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${tag}"></script>\n<script>${gtagConfigScript(tag)}</script>`;
}

export function buildGoogleTagBody(id: string): string {
  const tag = parseGoogleTagId(id);
  if (!tag?.startsWith("GTM-")) return "";
  return `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${tag}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;
}

const GOOGLE_CSP: Record<string, string[]> = {
  "script-src": ["https://www.googletagmanager.com", "https://www.google-analytics.com"],
  "connect-src": [
    "https://www.googletagmanager.com",
    "https://www.google-analytics.com",
    "https://analytics.google.com",
    "https://*.google-analytics.com",
    "https://*.analytics.google.com",
    "https://*.googletagmanager.com",
  ],
  "img-src": [
    "https://www.googletagmanager.com",
    "https://www.google-analytics.com",
    "https://*.google-analytics.com",
    "https://*.googletagmanager.com",
  ],
  "frame-src": ["https://www.googletagmanager.com"],
};

export function withGoogleTagCsp(csp: string, inlineScriptHashes: string[] = []): string {
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
  for (const [directive, sources] of Object.entries(GOOGLE_CSP)) {
    const existing = byName.get(directive);
    if (!existing) {
      order.push(directive);
      byName.set(directive, ["'self'", ...sources]);
      continue;
    }
    const next = new Set(existing);
    for (const source of sources) next.add(source);
    byName.set(directive, [...next]);
  }
  const scriptSrc = new Set(byName.get("script-src") ?? []);
  if (!scriptSrc.has("'unsafe-inline'")) {
    if (inlineScriptHashes.length > 0) {
      for (const hash of inlineScriptHashes) scriptSrc.add(hash);
    } else {
      scriptSrc.add("'unsafe-inline'");
    }
  }
  byName.set("script-src", [...scriptSrc]);
  if (!order.includes("script-src")) order.push("script-src");
  return order.map((directive) => [directive, ...(byName.get(directive) ?? [])].join(" ")).join("; ");
}
