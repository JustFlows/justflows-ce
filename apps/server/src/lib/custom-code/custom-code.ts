// SPDX-License-Identifier: MIT

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { getSiteSetting, setSiteSetting } from "../settings/site-settings.js";
import { isPluginCspSource } from "../security/csp-sources.js";
import { libraryTemplate, originOf, type ConsentCategory } from "./library.js";

/**
 * Custom code: JavaScript and markup an authorized administrator adds to
 * public pages (justflows-ce#94). Stored in a site setting, never in content,
 * so content editors and the content APIs cannot reach it. Scripts are kept
 * verbatim and only ever rendered by this module, allowed by the Content
 * Security Policy through a hash of each inline script and an operator
 * allowlist of external origins. `'unsafe-inline'` is never added.
 */

export const CUSTOM_CODE_SETTING = "custom_code";
export const CUSTOM_CODE_HISTORY_SETTING = "custom_code_history";
const MAX_SNIPPETS = 50;
const MAX_CODE_BYTES = 64 * 1024;
const MAX_HISTORY = 50;
const CACHE_MS = 30_000;
const CONSENT = ["necessary", "preferences", "analytics", "marketing"] as const;
export const PLACEMENTS = ["head", "bodyStart", "bodyEnd"] as const;
export type Placement = (typeof PLACEMENTS)[number];

const SnippetSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  placement: z.enum(PLACEMENTS),
  kind: z.enum(["inline", "external", "markup", "library"]),
  code: z.string().max(MAX_CODE_BYTES).optional(),
  src: z.string().max(2048).optional(),
  async: z.boolean().optional(),
  defer: z.boolean().optional(),
  library: z.object({ id: z.string().max(64), values: z.record(z.string().max(64), z.string().max(512)) }).optional(),
  scope: z.discriminatedUnion("type", [
    z.object({ type: z.literal("site") }),
    z.object({ type: z.literal("pages"), contentIds: z.array(z.string().uuid()).min(1).max(200) }),
  ]),
  consent: z.enum(CONSENT),
  environments: z.array(z.string().regex(/^[a-z0-9-]{1,32}$/)).max(10).default([]),
});

const ConfigSchema = z.object({
  safeMode: z.boolean().default(false),
  allowedOrigins: z.array(z.string().max(255)).max(50).default([]),
  snippets: z.array(SnippetSchema).max(MAX_SNIPPETS).default([]),
});

export type Snippet = z.infer<typeof SnippetSchema> & {
  id: string;
  updatedAt?: string;
  updatedBy?: string | null;
};

export interface CustomCodeConfig {
  safeMode: boolean;
  allowedOrigins: string[];
  snippets: Snippet[];
}

export interface CustomCodeVersion {
  version: number;
  savedAt: string;
  savedBy: string | null;
  config: CustomCodeConfig;
}

export interface ValidationResult {
  config: CustomCodeConfig | null;
  errors: string[];
  warnings: string[];
}

const EMPTY: CustomCodeConfig = { safeMode: false, allowedOrigins: [], snippets: [] };

/** The environment this installation runs as. Snippets can be limited to some. */
export function currentEnvironment(): string {
  const configured = (process.env.JF_ENVIRONMENT ?? "").trim().toLowerCase();
  if (/^[a-z0-9-]{1,32}$/.test(configured)) return configured;
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

/** `JF_CUSTOM_CODE=off` disables all custom code on this installation, e.g. on staging. */
export function customCodeDisabledByEnvironment(): boolean {
  return (process.env.JF_CUSTOM_CODE ?? "").trim().toLowerCase() === "off";
}

function normalize(raw: unknown): CustomCodeConfig {
  const parsed = ConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) return EMPTY;
  return {
    safeMode: parsed.data.safeMode,
    allowedOrigins: parsed.data.allowedOrigins,
    snippets: parsed.data.snippets.map((snippet) => ({ ...snippet, id: snippet.id ?? randomUUID().slice(0, 8) })) as Snippet[],
  };
}

export async function getCustomCode(siteId: string): Promise<CustomCodeConfig> {
  return normalize(await getSiteSetting(siteId, CUSTOM_CODE_SETTING));
}

export async function getCustomCodeHistory(siteId: string): Promise<CustomCodeVersion[]> {
  const raw = await getSiteSetting<CustomCodeVersion[]>(siteId, CUSTOM_CODE_HISTORY_SETTING);
  return Array.isArray(raw) ? raw : [];
}

/** Non-script markup is sanitized with the shared block sanitizer rules for custom markup. */
export async function sanitizeMarkup(html: string): Promise<string> {
  const { sanitizeCustomMarkup } = await import("@justflows/blocks");
  return sanitizeCustomMarkup(html);
}

const TRACKER = /\b(?:gtag|dataLayer|fbq|_paq|hj\(|clarity|ttq|_linkedin|plausible|umami|analytics\.js|pixel)\b/i;

/**
 * Check a configuration before it is saved. Errors refuse the save; warnings
 * are shown to the administrator with it.
 */
export async function validateCustomCode(raw: unknown): Promise<ValidationResult> {
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { config: null, errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`), warnings: [] };
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  const allowedOrigins = [...new Set(parsed.data.allowedOrigins.map((origin) => origin.trim().replace(/\/+$/, "")))];
  for (const origin of allowedOrigins) {
    if (!isPluginCspSource(origin)) errors.push(`"${origin}" is not an https origin such as https://cdn.example.com or https://*.example.com`);
  }
  const allows = (url: string) => {
    const origin = originOf(url);
    if (!origin) return false;
    const host = new URL(origin).hostname;
    return allowedOrigins.some((entry) => {
      if (entry === origin) return true;
      if (!entry.startsWith("https://*.")) return false;
      const suffix = entry.slice("https://*".length);
      return host.endsWith(suffix) && host.length > suffix.length;
    });
  };
  const ids = new Set<string>();
  const snippets: Snippet[] = [];
  for (const [index, input] of parsed.data.snippets.entries()) {
    const label = `"${input.name}"`;
    const id = input.id ?? randomUUID().slice(0, 8);
    if (ids.has(id)) errors.push(`${label}: duplicate id`);
    ids.add(id);
    const snippet: Snippet = { ...input, id } as Snippet;
    switch (input.kind) {
      case "inline": {
        const code = (input.code ?? "").trim();
        if (!code) errors.push(`${label}: the script is empty`);
        if (/<\/script/i.test(code)) errors.push(`${label}: the script must not contain </script>`);
        if (/<script\b/i.test(code)) errors.push(`${label}: enter JavaScript only, without <script> tags`);
        if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(code)) warnings.push(`${label}: runs strings as code (eval or new Function)`);
        if (/document\.write/.test(code)) warnings.push(`${label}: document.write blocks page rendering`);
        if (input.consent === "necessary" && TRACKER.test(code)) warnings.push(`${label}: looks like tracking code but runs without consent`);
        snippet.code = code;
        delete snippet.src;
        break;
      }
      case "external": {
        const src = (input.src ?? "").trim();
        if (!originOf(src)) errors.push(`${label}: the script URL must start with https://`);
        else if (!allows(src)) errors.push(`${label}: ${originOf(src)} is not in the allowed origins`);
        if (input.consent === "necessary" && TRACKER.test(src)) warnings.push(`${label}: looks like a tracker but loads without consent`);
        snippet.src = src;
        delete snippet.code;
        break;
      }
      case "markup": {
        const code = input.code ?? "";
        const clean = await sanitizeMarkup(code);
        if (!clean.trim()) errors.push(`${label}: nothing is left after removing unsafe markup`);
        else if (clean.replace(/\s+/g, "") !== code.replace(/\s+/g, "")) warnings.push(`${label}: unsafe tags or attributes were removed`);
        if (input.consent !== "necessary") errors.push(`${label}: only scripts can wait for consent; use a script snippet`);
        for (const match of clean.matchAll(/\b(?:src|href)="(https:[^"]+)"/g)) {
          if (!allows(match[1]!)) errors.push(`${label}: ${originOf(match[1]!) ?? match[1]} is not in the allowed origins`);
        }
        snippet.code = clean;
        delete snippet.src;
        break;
      }
      case "library": {
        const template = input.library ? libraryTemplate(input.library.id) : undefined;
        if (!template) {
          errors.push(`${label}: choose a snippet from the library`);
          break;
        }
        const values: Record<string, string> = {};
        for (const param of template.params) {
          const value = (input.library?.values[param.id] ?? "").trim();
          if (!value && param.optional) continue;
          if (!param.pattern.test(value)) errors.push(`${label}: ${param.label} must look like ${param.example}`);
          values[param.id] = value;
        }
        snippet.library = { id: template.id, values };
        if (input.consent === "necessary" && template.consent !== "necessary") {
          warnings.push(`${label}: ${template.name} usually needs ${template.consent} consent`);
        }
        delete snippet.code;
        delete snippet.src;
        break;
      }
    }
    if (snippet.placement === "head" && snippet.kind === "inline" && (snippet.code ?? "").length > 16 * 1024 && snippet.scope.type === "site") {
      warnings.push(`${label}: a large inline script in the head of every page delays rendering`);
    }
    if (index >= MAX_SNIPPETS) break;
    snippets.push(snippet);
  }
  return { config: errors.length ? null : { safeMode: parsed.data.safeMode, allowedOrigins, snippets }, errors, warnings };
}

const cache = new Map<string, { at: number; config: CustomCodeConfig }>();

async function cachedConfig(siteId: string): Promise<CustomCodeConfig> {
  const hit = cache.get(siteId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.config;
  /** A platform operator can turn custom code off for a hosted website. */
  const { siteFeatureEnabled } = await import("../tenancy/site-features.js");
  const allowed = await siteFeatureEnabled("feature.customCode", siteId).catch(() => true);
  const config = allowed ? await getCustomCode(siteId) : EMPTY;
  cache.set(siteId, { at: Date.now(), config });
  return config;
}

export function invalidateCustomCodeCache(siteId?: string): void {
  if (siteId) cache.delete(siteId);
  else cache.clear();
}

/** Snippets that run on this request, before page scope is applied. */
function liveSnippets(config: CustomCodeConfig): Snippet[] {
  if (config.safeMode || customCodeDisabledByEnvironment()) return [];
  const environment = currentEnvironment();
  return config.snippets.filter((snippet) => snippet.enabled && (snippet.environments.length === 0 || snippet.environments.includes(environment)));
}

/** The scripts a snippet becomes, as inline bodies and external URLs. */
function scriptsOf(snippet: Snippet): Array<{ inline?: string; src?: string }> {
  if (snippet.kind === "inline") return [{ inline: snippet.code ?? "" }];
  if (snippet.kind === "external") return [{ src: snippet.src ?? "" }];
  if (snippet.kind === "library") {
    const template = snippet.library ? libraryTemplate(snippet.library.id) : undefined;
    return template ? template.render(snippet.library!.values) : [];
  }
  return [];
}

const attr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function renderSnippet(snippet: Snippet): string {
  if (snippet.kind === "markup") return `<!-- custom code: ${attr(snippet.name).replace(/--/g, "")} -->${snippet.code ?? ""}`;
  const gated = snippet.consent !== "necessary";
  const marker = `data-jf-custom-code="${attr(snippet.id)}"`;
  return scriptsOf(snippet)
    .map((script) => {
      if (script.src) {
        const loading = snippet.kind === "external" && snippet.defer ? " defer" : " async";
        return gated
          ? `<script type="text/plain" data-jf-consent="${snippet.consent}" data-jf-src="${attr(script.src)}"${loading} ${marker}></script>`
          : `<script src="${attr(script.src)}"${loading} ${marker}></script>`;
      }
      const body = (script.inline ?? "").replace(/<\/script/gi, "<\\/script");
      return gated
        ? `<script type="text/plain" data-jf-consent="${snippet.consent}" ${marker}>${body}</script>`
        : `<script ${marker}>${body}</script>`;
    })
    .join("");
}

export interface RenderedCustomCode {
  head: string;
  bodyStart: string;
  bodyEnd: string;
}

/**
 * Markup for one public page. Nothing on previews and private account pages,
 * in safe mode, or when the environment turns custom code off.
 */
export async function renderCustomCode(
  siteId: string,
  page: { contentId?: string | undefined; preview?: boolean; privateAccount?: boolean },
): Promise<RenderedCustomCode> {
  const out: RenderedCustomCode = { head: "", bodyStart: "", bodyEnd: "" };
  if (page.preview || page.privateAccount) return out;
  const config = await cachedConfig(siteId);
  for (const snippet of liveSnippets(config)) {
    if (snippet.scope.type === "pages" && (!page.contentId || !snippet.scope.contentIds.includes(page.contentId))) continue;
    out[snippet.placement] += renderSnippet(snippet);
  }
  return out;
}

export interface CustomCodeCsp {
  hashes: string[];
  script: string[];
  connect: string[];
  img: string[];
  frame: string[];
}

/** CSP additions for every live snippet: inline hashes, allowlisted origins, and library origins. */
export async function customCodeCsp(siteId: string): Promise<CustomCodeCsp | null> {
  const config = await cachedConfig(siteId);
  const live = liveSnippets(config);
  if (live.length === 0) return null;
  const out: CustomCodeCsp = { hashes: [], script: [], connect: [], img: [], frame: [] };
  const add = (list: string[], values: readonly string[]) => {
    for (const value of values) if (isPluginCspSource(value) && !list.includes(value)) list.push(value);
  };
  if (live.some((snippet) => snippet.kind === "external" || snippet.kind === "markup")) {
    add(out.script, config.allowedOrigins);
    add(out.connect, config.allowedOrigins);
    add(out.img, config.allowedOrigins);
    add(out.frame, config.allowedOrigins);
  }
  for (const snippet of live) {
    for (const script of scriptsOf(snippet)) {
      if (script.inline !== undefined) {
        const body = script.inline.replace(/<\/script/gi, "<\\/script");
        const hash = `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;
        if (!out.hashes.includes(hash)) out.hashes.push(hash);
      }
    }
    if (snippet.kind === "library" && snippet.library) {
      const template = libraryTemplate(snippet.library.id);
      if (!template) continue;
      add(out.script, template.origins.script);
      add(out.connect, template.origins.connect ?? []);
      add(out.img, template.origins.img ?? []);
      add(out.frame, template.origins.frame ?? []);
      const selfHosted = originOf(snippet.library.values["url"] ?? snippet.library.values["host"] ?? "");
      if (selfHosted) {
        add(out.script, [selfHosted]);
        add(out.connect, [selfHosted]);
        add(out.img, [selfHosted]);
      }
    }
  }
  return out;
}

/**
 * Add inline hashes to the script directives. A policy that already allows
 * `'unsafe-inline'` is left alone, because a hash would switch that off.
 */
export function withCustomCodeHashes(csp: string, hashes: readonly string[]): string {
  if (hashes.length === 0) return csp;
  const parts = csp.split(";").map((part) => part.trim()).filter(Boolean);
  const index = (name: string) => parts.findIndex((part) => part.split(/\s+/)[0]?.toLowerCase() === name);
  let touched = false;
  for (const name of ["script-src", "script-src-elem"]) {
    const at = index(name);
    if (at < 0) continue;
    touched = true;
    const sources = parts[at]!.split(/\s+/).slice(1);
    if (sources.includes("'unsafe-inline'") || sources.includes("'none'")) continue;
    parts[at] = [parts[at], ...hashes.filter((hash) => !sources.includes(hash))].join(" ");
  }
  if (!touched) {
    const fallback = index("default-src");
    if (fallback < 0) return csp;
    const sources = parts[fallback]!.split(/\s+/).slice(1);
    if (sources.includes("'unsafe-inline'")) return csp;
    parts.push(["script-src", ...sources.filter((source) => source !== "'none'"), ...hashes].join(" "));
  }
  return parts.join("; ");
}

function summarize(snippet: Snippet): string {
  const where = snippet.scope.type === "site" ? "all pages" : `${snippet.scope.contentIds.length} page(s)`;
  return `${snippet.name} [${snippet.kind}, ${snippet.placement}, ${where}, consent ${snippet.consent}, ${snippet.enabled ? "on" : "off"}]`;
}

function codeOf(snippet: Snippet): string {
  return snippet.kind === "library" ? JSON.stringify(snippet.library) : snippet.kind === "external" ? snippet.src ?? "" : snippet.code ?? "";
}

/** A compact, human-readable diff of two configurations, for the audit log. */
export function describeChanges(before: CustomCodeConfig, after: CustomCodeConfig): string {
  const lines: string[] = [];
  if (before.safeMode !== after.safeMode) lines.push(`safe mode ${after.safeMode ? "on" : "off"}`);
  const added = after.allowedOrigins.filter((origin) => !before.allowedOrigins.includes(origin));
  const removed = before.allowedOrigins.filter((origin) => !after.allowedOrigins.includes(origin));
  if (added.length) lines.push(`+ origins ${added.join(" ")}`);
  if (removed.length) lines.push(`- origins ${removed.join(" ")}`);
  const previous = new Map(before.snippets.map((snippet) => [snippet.id, snippet]));
  for (const snippet of after.snippets) {
    const old = previous.get(snippet.id);
    previous.delete(snippet.id);
    if (!old) {
      lines.push(`+ ${summarize(snippet)}`);
      continue;
    }
    if (summarize(old) !== summarize(snippet)) lines.push(`~ ${summarize(old)} -> ${summarize(snippet)}`);
    const oldLines = codeOf(old).split("\n");
    const newLines = codeOf(snippet).split("\n");
    if (oldLines.join("\n") !== newLines.join("\n")) {
      const gone = oldLines.filter((line) => !newLines.includes(line));
      const fresh = newLines.filter((line) => !oldLines.includes(line));
      lines.push(`~ ${snippet.name} code: ${gone.map((line) => `-${line.trim().slice(0, 120)}`).concat(fresh.map((line) => `+${line.trim().slice(0, 120)}`)).join(" ")}`);
    }
  }
  for (const snippet of previous.values()) lines.push(`- ${summarize(snippet)}`);
  return lines.join("\n") || "no changes";
}

/** Save a validated configuration and keep the previous versions for review. */
export async function saveCustomCode(
  siteId: string,
  next: CustomCodeConfig,
  actor: { userId: string | null },
): Promise<{ version: number; diff: string }> {
  const before = await getCustomCode(siteId);
  const stamp = new Date().toISOString();
  const previousIds = new Map(before.snippets.map((snippet) => [snippet.id, snippet]));
  const stamped: CustomCodeConfig = {
    ...next,
    snippets: next.snippets.map((snippet) => {
      const old = previousIds.get(snippet.id);
      const changed = !old || JSON.stringify({ ...old, updatedAt: undefined, updatedBy: undefined }) !== JSON.stringify({ ...snippet, updatedAt: undefined, updatedBy: undefined });
      return changed ? { ...snippet, updatedAt: stamp, updatedBy: actor.userId } : { ...snippet, updatedAt: old.updatedAt, updatedBy: old.updatedBy };
    }),
  };
  const history = await getCustomCodeHistory(siteId);
  const version = (history[0]?.version ?? 0) + 1;
  await setSiteSetting(siteId, CUSTOM_CODE_SETTING, stamped);
  await setSiteSetting(siteId, CUSTOM_CODE_HISTORY_SETTING, [{ version, savedAt: stamp, savedBy: actor.userId, config: stamped }, ...history].slice(0, MAX_HISTORY));
  invalidateCustomCodeCache(siteId);
  return { version, diff: describeChanges(before, stamped) };
}
