import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type {
  PluginContext,
  PluginHttpHandler,
  PluginHttpRequest,
  PluginHttpResponse,
} from "@justflows/sdk";
import {
  loadConfig,
  OPTIONAL_CATEGORIES,
  policyHash,
  saveConfig,
  type ConsentConfig,
} from "./config.js";
import { setCachedConfig } from "./state.js";

export const ROUTE_BASE = "/ext/justflows.consent";
export const RECORD_PATH = `${ROUTE_BASE}/record`;
export const RUNTIME_PATH = `${ROUTE_BASE}/runtime.js`;
export const COOKIES_PATH = `${ROUTE_BASE}/cookies`;

export interface StoredRecord {
  cid: string;
  policyVersion: string;
  policyHash: string;
  choices: Record<string, boolean>;
  locale: string;
  device: "mobile" | "tablet" | "desktop";
  method: string;
  ts: string;
}

let runtimeCache: string | undefined;

async function runtimeSource(): Promise<string> {
  if (runtimeCache === undefined) {
    runtimeCache = await readFile(
      fileURLToPath(new URL("./runtime/runtime.js", import.meta.url)),
      "utf8",
    );
  }
  return runtimeCache;
}

function isAdmin(req: PluginHttpRequest): boolean {
  return req.session?.role === "administrator";
}

function requireAdmin(handler: PluginHttpHandler): PluginHttpHandler {
  return async (req) =>
    isAdmin(req) ? handler(req) : { status: 403, body: { error: "Forbidden" } };
}

const CID_RE = /^[a-z0-9-]{8,64}$/i;
const LOCALE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

function deviceFromUa(ua: string): StoredRecord["device"] {
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android/i.test(ua)) return "mobile";
  return "desktop";
}

function parseChoices(raw: string): Record<string, boolean> {
  const choices: Record<string, boolean> = { necessary: true };
  for (const pair of raw.split(",").slice(0, 12)) {
    const [key, value] = pair.split(":");
    if (key && OPTIONAL_CATEGORIES.includes(key.trim() as never)) {
      choices[key.trim()] = value?.trim() === "1";
    }
  }
  for (const category of OPTIONAL_CATEGORIES) {
    if (!(category in choices)) choices[category] = false;
  }
  return choices;
}

function sameChoices(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  return ["necessary", ...OPTIONAL_CATEGORIES].every((key) => Boolean(a[key]) === Boolean(b[key]));
}

const ALLOWED_KEYS: Array<keyof ConsentConfig> = [
  "enabled",
  "displayMode",
  "logConsent",
  "policyVersion",
  "privacyPolicyUrl",
  "reopenSelector",
  "categories",
  "gateEmbeds",
  "analyticsSnippet",
  "marketingSnippet",
  "design",
  "defaultLocale",
  "translations",
];

/**
 * Whitelist the known top-level keys. All clamping, enum checks, locale
 * validation, and CSS-value validation happen in `coerceConfig` (via
 * `saveConfig`), so this only has to drop unknown keys — never trust a body
 * verbatim, even from an administrator.
 */
export function sanitizeConfigPatch(body: unknown): Partial<ConsentConfig> {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    if (key in input) patch[key as string] = input[key as string];
  }
  return patch as Partial<ConsentConfig>;
}

function toCsv(rows: StoredRecord[]): string {
  const header = [
    "cid",
    "ts",
    "policyVersion",
    "policyHash",
    "locale",
    "device",
    "method",
    "necessary",
    ...OPTIONAL_CATEGORIES,
  ];
  const escape = (value: string): string =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const lines = rows.map((row) =>
    [
      row.cid,
      row.ts,
      row.policyVersion,
      row.policyHash,
      row.locale,
      row.device,
      row.method,
      String(Boolean(row.choices["necessary"])),
      ...OPTIONAL_CATEGORIES.map((category) => String(Boolean(row.choices[category]))),
    ]
      .map((value) => escape(String(value)))
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function registerRoutes(ctx: PluginContext): void {
  ctx.http.get(RUNTIME_PATH, async (): Promise<PluginHttpResponse> => ({
    status: 200,
    type: "application/javascript; charset=utf-8",
    headers: { "Cache-Control": "public, max-age=300" },
    body: await runtimeSource(),
  }));

  // Public cookie disclosure: the full site registry (core + every active
  // plugin) with operator overrides applied. The runtime uses `effective` to
  // build the preference-center cookie table and to expire cookies whose
  // category is withdrawn. Nothing sensitive — this is a cookie policy.
  ctx.http.get(COOKIES_PATH, async (): Promise<PluginHttpResponse> => {
    const config = await loadConfig(ctx);
    if (!config.enabled || config.displayMode === "off") {
      return {
        status: 200,
        headers: { "Cache-Control": "public, max-age=60" },
        body: { cookies: [] },
      };
    }
    const cookies = (await ctx.cookies.list()).map((c) => ({
      name: c.name,
      category: c.effectiveCategory,
      declared: c.category,
      purpose: c.purpose,
      provider: c.provider ?? "",
      duration: c.duration ?? "",
      setBy: c.declaredBy,
    }));
    return {
      status: 200,
      headers: { "Cache-Control": "public, max-age=60" },
      body: { cookies },
    };
  });

  // Consent beacon. GET on purpose: an anonymous visitor has no CSRF cookie, so
  // a POST here is always rejected by the host CSRF middleware. The payload is
  // tiny and idempotent (compare-and-skip below), so a GET beacon is safe.
  ctx.http.get(RECORD_PATH, async (req): Promise<PluginHttpResponse> => {
    const config = await loadConfig(ctx);
    // Nothing is stored when disabled, geo-off, or logging is turned off.
    if (!config.enabled || config.displayMode === "off" || !config.logConsent) {
      return { status: 204 };
    }

    const cid = String(req.query["cid"] ?? "");
    if (!CID_RE.test(cid)) return { status: 400, body: { error: "bad cid" } };
    const locale = String(req.query["l"] ?? "").slice(0, 35);

    const record: StoredRecord = {
      cid,
      policyVersion: config.policyVersion,
      policyHash: policyHash(config),
      choices: parseChoices(String(req.query["c"] ?? "")),
      locale: LOCALE_RE.test(locale) ? locale : "",
      device: deviceFromUa(String(req.headers["user-agent"] ?? "")),
      method: String(req.query["m"] ?? "custom").slice(0, 16),
      ts: new Date().toISOString(),
    };

    const existing = await ctx.data.get<StoredRecord>("records", cid);
    if (
      existing &&
      existing.data.policyHash === record.policyHash &&
      sameChoices(existing.data.choices, record.choices)
    ) {
      return { status: 204 };
    }
    await ctx.data.put("records", cid, record);
    return { status: 204 };
  });

  ctx.http.get(
    `${ROUTE_BASE}/config`,
    requireAdmin(async () => ({
      status: 200,
      body: (await loadConfig(ctx)) as unknown as Record<string, unknown>,
    })),
  );

  ctx.http.put(
    `${ROUTE_BASE}/config`,
    requireAdmin(async (req) => {
      const next = await saveConfig(ctx, sanitizeConfigPatch(req.body));
      setCachedConfig(next);
      return { status: 200, body: next as unknown as Record<string, unknown> };
    }),
  );

  ctx.http.get(
    `${ROUTE_BASE}/records`,
    requireAdmin(async (req) => {
      const limit = Math.min(Math.max(Number(req.query["limit"] ?? 200) || 200, 1), 1000);
      const rows = (await ctx.data.list<StoredRecord>("records"))
        .map((row) => row.data)
        .sort((a, b) => b.ts.localeCompare(a.ts))
        .slice(0, limit);
      return { status: 200, body: { total: rows.length, records: rows } };
    }),
  );

  ctx.http.get(
    `${ROUTE_BASE}/records.csv`,
    requireAdmin(async () => {
      const rows = (await ctx.data.list<StoredRecord>("records"))
        .map((row) => row.data)
        .sort((a, b) => b.ts.localeCompare(a.ts));
      return {
        status: 200,
        type: "text/csv; charset=utf-8",
        headers: { "Content-Disposition": 'attachment; filename="consent-records.csv"' },
        body: toCsv(rows),
      };
    }),
  );

  ctx.http.delete(
    `${ROUTE_BASE}/records/:cid`,
    requireAdmin(async (req) => {
      await ctx.data.delete("records", String(req.params["cid"] ?? ""));
      return { status: 204 };
    }),
  );
}

export const __test__ = { parseChoices, sameChoices, toCsv, deviceFromUa };
