// SPDX-License-Identifier: MIT

import { z } from "zod";
import { getSiteId, getSiteSetting, setSiteSetting } from "./site-settings.js";
import { getJfCache } from "./jf-cache.js";

/** Site setting key holding the whole security-header configuration. */
export const SECURITY_HEADERS_SETTING_KEY = "security_headers";

/**
 * Where a header is emitted.
 *  - `all`    every response
 *  - `public` the public site only (never the admin SPA or the API)
 *  - `admin`  the admin SPA, its assets and the API only
 *
 * Splitting the scope matters for policies such as CSP: a policy that is right
 * for a themed public page usually breaks the React admin, and vice versa.
 */
export const HEADER_SCOPES = ["all", "public", "admin"] as const;
export type HeaderScope = (typeof HEADER_SCOPES)[number];

export const SECURITY_HEADER_IDS = [
  "x_frame_options",
  "strict_transport_security",
  "referrer_policy",
  "x_content_type_options",
  "content_security_policy",
  "permissions_policy",
  "cross_origin_embedder_policy",
  "cross_origin_opener_policy",
  "cross_origin_resource_policy",
  "x_permitted_cross_domain_policies",
  "x_dns_prefetch_control",
  "origin_agent_cluster",
  "x_xss_protection",
] as const;
export type SecurityHeaderId = (typeof SECURITY_HEADER_IDS)[number];

/** How the admin UI should render the editor for a header. */
export type HeaderEditor = "choice" | "hsts" | "csp" | "permissions" | "text";

export type HeaderOption = {
  value: string;
  /** Short label for the radio/select entry. */
  label: string;
  /** One line explaining what this value does. */
  hint: string;
  /** Marks the value we steer people towards. */
  recommended?: boolean;
};

export type SecurityHeaderDef = {
  id: SecurityHeaderId;
  /** The wire name, used verbatim in the response. */
  header: string;
  title: string;
  /** What the header does, in plain language. */
  description: string;
  editor: HeaderEditor;
  options?: HeaderOption[];
  /** Value used when the header is first switched on. */
  defaultValue: string;
  defaultScope: HeaderScope;
  /** True when leaving this header off is a real weakness worth flagging. */
  recommended: boolean;
  docs: string;
};

/**
 * Every header the platform can emit, with the metadata the admin UI needs to
 * render a proper editor for it. This is the single source of truth — the API
 * ships it to the browser so the UI never hardcodes a second copy.
 */
export const SECURITY_HEADER_DEFS: SecurityHeaderDef[] = [
  {
    id: "content_security_policy",
    header: "Content-Security-Policy",
    title: "Content Security Policy",
    description:
      "Controls which scripts, styles, images and frames the browser is allowed to load. The single most effective defence against cross-site scripting.",
    editor: "csp",
    defaultValue:
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; img-src 'self' data: https:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'",
    defaultScope: "public",
    recommended: true,
    docs: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Content-Security-Policy",
  },
  {
    id: "strict_transport_security",
    header: "Strict-Transport-Security",
    title: "HTTP Strict Transport Security",
    description:
      "Tells the browser to only ever reach this site over HTTPS, which removes the downgrade window an attacker on the network could use.",
    editor: "hsts",
    defaultValue: "max-age=31536000; includeSubDomains",
    defaultScope: "all",
    recommended: true,
    docs: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Strict-Transport-Security",
  },
  {
    id: "x_frame_options",
    header: "X-Frame-Options",
    title: "X-Frame-Options",
    description:
      "Stops other sites from putting your pages in a frame, which is what clickjacking attacks rely on. The modern equivalent is the CSP frame-ancestors directive.",
    editor: "choice",
    options: [
      { value: "SAMEORIGIN", label: "SAMEORIGIN", hint: "Only your own site may frame these pages.", recommended: true },
      { value: "DENY", label: "DENY", hint: "No site at all may frame these pages, not even your own." },
    ],
    defaultValue: "SAMEORIGIN",
    defaultScope: "all",
    recommended: true,
    docs: "https://developer.mozilla.org/docs/Web/HTTP/Headers/X-Frame-Options",
  },
  {
    id: "x_content_type_options",
    header: "X-Content-Type-Options",
    title: "X-Content-Type-Options",
    description:
      "Stops the browser guessing a file's type from its content. Without it an uploaded image can sometimes be coaxed into running as a script.",
    editor: "choice",
    options: [
      { value: "nosniff", label: "nosniff", hint: "Always trust the declared Content-Type.", recommended: true },
    ],
    defaultValue: "nosniff",
    defaultScope: "all",
    recommended: true,
    docs: "https://developer.mozilla.org/docs/Web/HTTP/Headers/X-Content-Type-Options",
  },
  {
    id: "referrer_policy",
    header: "Referrer-Policy",
    title: "Referrer Policy",
    description:
      "Decides how much of the current URL is passed along when a visitor follows a link off your site.",
    editor: "choice",
    options: [
      { value: "no-referrer", label: "no-referrer", hint: "Never send a referrer. Most private, breaks some analytics." },
      {
        value: "strict-origin-when-cross-origin",
        label: "strict-origin-when-cross-origin",
        hint: "Full URL within your site, bare origin to other sites, nothing on a downgrade to HTTP.",
        recommended: true,
      },
      { value: "same-origin", label: "same-origin", hint: "Referrer only within your own site." },
      { value: "strict-origin", label: "strict-origin", hint: "Only the origin, and never over an insecure downgrade." },
      { value: "origin", label: "origin", hint: "Only the origin, including on downgrades." },
      { value: "origin-when-cross-origin", label: "origin-when-cross-origin", hint: "Full URL internally, origin externally." },
      { value: "no-referrer-when-downgrade", label: "no-referrer-when-downgrade", hint: "The old browser default." },
      { value: "unsafe-url", label: "unsafe-url", hint: "Always send the full URL. Leaks paths and query strings." },
    ],
    defaultValue: "strict-origin-when-cross-origin",
    defaultScope: "all",
    recommended: true,
    docs: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Referrer-Policy",
  },
  {
    id: "permissions_policy",
    header: "Permissions-Policy",
    title: "Permissions Policy",
    description:
      "Switches off browser features your site does not use — camera, microphone, geolocation and so on — so that injected code cannot reach them either.",
    editor: "permissions",
    defaultValue:
      "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), xr-spatial-tracking=()",
    defaultScope: "all",
    recommended: true,
    docs: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Permissions-Policy",
  },
  {
    id: "cross_origin_embedder_policy",
    header: "Cross-Origin-Embedder-Policy",
    title: "Cross-Origin Embedder Policy",
    description:
      "Prevents assets being loaded that do not grant permission to load them via CORS or CORP. Required, together with COOP, to unlock cross-origin isolation.",
    editor: "choice",
    options: [
      { value: "unsafe-none", label: "unsafe-none", hint: "The browser default — no restriction." },
      {
        value: "require-corp",
        label: "require-corp",
        hint: "Third-party assets must opt in via CORS or CORP. Strongest, and the most likely to break embeds.",
        recommended: true,
      },
      {
        value: "credentialless",
        label: "credentialless",
        hint: "Cross-origin assets load without credentials instead of being blocked. A gentler path to isolation.",
      },
    ],
    defaultValue: "require-corp",
    defaultScope: "public",
    recommended: false,
    docs: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Cross-Origin-Embedder-Policy",
  },
  {
    id: "cross_origin_opener_policy",
    header: "Cross-Origin-Opener-Policy",
    title: "Cross-Origin Opener Policy",
    description:
      "Lets the site opt in to cross-origin isolation, so a page you open (or that opens you) cannot keep a handle on your window.",
    editor: "choice",
    options: [
      { value: "unsafe-none", label: "unsafe-none", hint: "The browser default — no restriction." },
      {
        value: "same-origin",
        label: "same-origin",
        hint: "Full isolation from other origins. Breaks cross-origin popups such as some OAuth flows.",
        recommended: true,
      },
      {
        value: "same-origin-allow-popups",
        label: "same-origin-allow-popups",
        hint: "Isolates the document but keeps popups you open working. The safe middle ground.",
      },
    ],
    defaultValue: "same-origin",
    defaultScope: "all",
    recommended: true,
    docs: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Cross-Origin-Opener-Policy",
  },
  {
    id: "cross_origin_resource_policy",
    header: "Cross-Origin-Resource-Policy",
    title: "Cross-Origin Resource Policy",
    description:
      "Lets you say who is allowed to load your pages and files at all, which blunts side-channel attacks that read cross-origin responses.",
    editor: "choice",
    options: [
      { value: "same-origin", label: "same-origin", hint: "Only your own origin may load these resources." },
      {
        value: "same-site",
        label: "same-site",
        hint: "Your site and its subdomains may load these resources.",
        recommended: true,
      },
      { value: "cross-origin", label: "cross-origin", hint: "Anyone may load them. Use for a public CDN or embeddable assets." },
    ],
    defaultValue: "same-site",
    defaultScope: "all",
    recommended: true,
    docs: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Cross-Origin-Resource-Policy",
  },
  {
    id: "x_permitted_cross_domain_policies",
    header: "X-Permitted-Cross-Domain-Policies",
    title: "Permitted Cross-Domain Policies",
    description:
      "Tells Adobe clients (and a few crawlers) whether a crossdomain.xml file on your host should be honoured.",
    editor: "choice",
    options: [
      { value: "none", label: "none", hint: "No cross-domain policy file is allowed.", recommended: true },
      { value: "master-only", label: "master-only", hint: "Only the policy file at the site root counts." },
      { value: "by-content-type", label: "by-content-type", hint: "Only policy files served as text/x-cross-domain-policy." },
      { value: "all", label: "all", hint: "Any policy file counts. Not recommended." },
    ],
    defaultValue: "none",
    defaultScope: "all",
    recommended: false,
    docs: "https://owasp.org/www-project-secure-headers/#x-permitted-cross-domain-policies",
  },
  {
    id: "x_dns_prefetch_control",
    header: "X-DNS-Prefetch-Control",
    title: "DNS Prefetch Control",
    description:
      "Controls whether the browser resolves the hostnames behind links before the visitor clicks them. Off is more private, on is slightly faster.",
    editor: "choice",
    options: [
      { value: "off", label: "off", hint: "No speculative DNS lookups.", recommended: true },
      { value: "on", label: "on", hint: "Resolve linked hostnames ahead of time." },
    ],
    defaultValue: "off",
    defaultScope: "all",
    recommended: false,
    docs: "https://developer.mozilla.org/docs/Web/HTTP/Headers/X-DNS-Prefetch-Control",
  },
  {
    id: "origin_agent_cluster",
    header: "Origin-Agent-Cluster",
    title: "Origin Agent Cluster",
    description:
      "Asks the browser to give this origin its own process-level agent cluster, so a heavy or hostile same-site document cannot share memory with it.",
    editor: "choice",
    options: [
      { value: "?1", label: "?1", hint: "Request origin-keyed isolation.", recommended: true },
      { value: "?0", label: "?0", hint: "Explicitly stay site-keyed (the default)." },
    ],
    defaultValue: "?1",
    defaultScope: "all",
    recommended: false,
    docs: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Origin-Agent-Cluster",
  },
  {
    id: "x_xss_protection",
    header: "X-XSS-Protection",
    title: "X-XSS-Protection (legacy)",
    description:
      "Controls the XSS filter in long-obsolete browsers. The filter itself introduced vulnerabilities, so the modern advice is to send 0 or nothing at all and rely on CSP.",
    editor: "choice",
    options: [
      { value: "0", label: "0", hint: "Disable the legacy filter. This is the current recommendation.", recommended: true },
      { value: "1; mode=block", label: "1; mode=block", hint: "Block the page on a suspected reflection. Deprecated." },
      { value: "1", label: "1", hint: "Sanitise the page. Deprecated and unsafe." },
    ],
    defaultValue: "0",
    defaultScope: "all",
    recommended: false,
    docs: "https://developer.mozilla.org/docs/Web/HTTP/Headers/X-XSS-Protection",
  },
];

const DEFS_BY_ID = new Map(SECURITY_HEADER_DEFS.map((d) => [d.id, d]));

export function getHeaderDef(id: SecurityHeaderId): SecurityHeaderDef {
  const def = DEFS_BY_ID.get(id);
  if (!def) throw new Error(`Unknown security header: ${id}`);
  return def;
}

// ─── Configuration shape ─────────────────────────────────────────────────────

export type HeaderEntry = {
  enabled: boolean;
  scope: HeaderScope;
  value: string;
  /** CSP only: enforce the policy or just collect violation reports. */
  mode?: "enforce" | "report-only";
  /** HSTS only: hold the header back on plain-HTTP requests. */
  onlyWhenSecure?: boolean;
};

export type CustomHeader = {
  name: string;
  value: string;
  enabled: boolean;
  scope: HeaderScope;
};

export type SecurityHeadersConfig = {
  headers: Record<SecurityHeaderId, HeaderEntry>;
  custom: CustomHeader[];
  /** Strip the `Server` banner that a reverse proxy may have added. */
  removeServerHeader: boolean;
};

/**
 * Header values end up in the response verbatim, so anything that could break
 * out of the field — CR, LF, NUL — has to be refused rather than stripped.
 */
const HEADER_VALUE_RE = /^[\t\x20-\x7E]*$/;
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/**
 * Headers that frame the response body. Letting an administrator override these
 * would corrupt every response rather than harden it.
 */
const PROTECTED_HEADER_NAMES = new Set([
  "content-length",
  "content-type",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "trailer",
  "te",
  "host",
  "date",
  "location",
  "set-cookie",
]);

export function isProtectedHeaderName(name: string): boolean {
  return PROTECTED_HEADER_NAMES.has(name.trim().toLowerCase());
}

const headerValue = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => HEADER_VALUE_RE.test(v), {
      message: "Header values may not contain line breaks or control characters",
    });

const EntrySchema = z.object({
  enabled: z.boolean(),
  scope: z.enum(HEADER_SCOPES),
  value: headerValue(8192),
  mode: z.enum(["enforce", "report-only"]).optional(),
  onlyWhenSecure: z.boolean().optional(),
});

const CustomHeaderSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(128)
    .refine((v) => HEADER_NAME_RE.test(v), { message: "Invalid header name" })
    .refine((v) => !isProtectedHeaderName(v), {
      message: "This header controls the response body and cannot be overridden",
    }),
  value: headerValue(8192),
  enabled: z.boolean(),
  scope: z.enum(HEADER_SCOPES),
});

export const SecurityHeadersConfigSchema = z
  .object({
    headers: z.object(
      Object.fromEntries(SECURITY_HEADER_IDS.map((id) => [id, EntrySchema])) as Record<
        SecurityHeaderId,
        typeof EntrySchema
      >,
    ),
    custom: z.array(CustomHeaderSchema).max(50),
    removeServerHeader: z.boolean(),
  })
  .superRefine((cfg, ctx) => {
    // A fixed-vocabulary header with an off-list value produces a header the
    // browser ignores, which looks protected but is not. Catch it at save time.
    for (const def of SECURITY_HEADER_DEFS) {
      const entry = cfg.headers[def.id];
      if (!entry.enabled) continue;
      if (!entry.value.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["headers", def.id, "value"],
          message: `${def.header} is enabled but has no value`,
        });
        continue;
      }
      if (def.options) {
        const allowed = def.options.map((o) => o.value.toLowerCase());
        if (!allowed.includes(entry.value.trim().toLowerCase())) {
          ctx.addIssue({
            code: "custom",
            path: ["headers", def.id, "value"],
            message: `${def.header} must be one of: ${def.options.map((o) => o.value).join(", ")}`,
          });
        }
      }
    }

    const seen = new Set<string>();
    for (const [i, h] of cfg.custom.entries()) {
      const key = h.name.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["custom", i, "name"],
          message: `Duplicate header: ${h.name}`,
        });
      }
      seen.add(key);
      if (SECURITY_HEADER_DEFS.some((d) => d.header.toLowerCase() === key)) {
        ctx.addIssue({
          code: "custom",
          path: ["custom", i, "name"],
          message: `${h.name} has its own setting above — configure it there instead`,
        });
      }
    }
  });

/**
 * The shipped configuration. It reproduces exactly the headers Justflows sent
 * before this screen existed, so upgrading changes nothing until the site owner
 * turns something on themselves.
 */
export function defaultConfig(): SecurityHeadersConfig {
  const headers = {} as Record<SecurityHeaderId, HeaderEntry>;
  const enabledByDefault = new Set<SecurityHeaderId>([
    "x_frame_options",
    "x_content_type_options",
    "referrer_policy",
    "strict_transport_security",
    // On by default since 0.1.2. CSP is the only header here that stops script
    // injection from becoming account takeover, so it is worth the small chance
    // that a third-party theme has to drop an inline <script>. Its scope is
    // "public", so the React admin is untouched. A site that needs it off can
    // clear it in Admin → Security, or set JF_SECURITY_HEADERS_DISABLED=1 to
    // fall back to the shipped defaults without database access.
    "content_security_policy",
  ]);

  for (const def of SECURITY_HEADER_DEFS) {
    const entry: HeaderEntry = {
      enabled: enabledByDefault.has(def.id),
      scope: def.defaultScope,
      value: def.defaultValue,
    };
    if (def.id === "content_security_policy") entry.mode = "enforce";
    if (def.id === "strict_transport_security") entry.onlyWhenSecure = true;
    headers[def.id] = entry;
  }

  return { headers, custom: [], removeServerHeader: false };
}

/** The configuration we nudge people towards from the Overview screen. */
export function recommendedConfig(): SecurityHeadersConfig {
  const cfg = defaultConfig();
  for (const def of SECURITY_HEADER_DEFS) {
    if (!def.recommended) continue;
    cfg.headers[def.id].enabled = true;
    const preferred = def.options?.find((o) => o.recommended)?.value;
    if (preferred) cfg.headers[def.id].value = preferred;
  }
  // CSP now ships enabled and enforcing (see defaultConfig), so the recommended
  // configuration must not quietly downgrade it to report-only.
  cfg.headers.content_security_policy.mode = "enforce";
  return cfg;
}

/**
 * Fill in anything a stored config is missing. Configs written by an older
 * release will not know about headers added since, and we would rather fall
 * back to the default entry than throw the whole config away.
 */
export function normalizeConfig(raw: unknown): SecurityHeadersConfig {
  const base = defaultConfig();
  if (!raw || typeof raw !== "object") return base;

  const input = raw as Partial<SecurityHeadersConfig>;
  const headers = {} as Record<SecurityHeaderId, HeaderEntry>;

  for (const def of SECURITY_HEADER_DEFS) {
    const stored = input.headers?.[def.id];
    const fallback = base.headers[def.id];
    if (!stored || typeof stored !== "object") {
      headers[def.id] = fallback;
      continue;
    }
    const entry: HeaderEntry = {
      enabled: typeof stored.enabled === "boolean" ? stored.enabled : fallback.enabled,
      scope: (HEADER_SCOPES as readonly string[]).includes(stored.scope as string)
        ? (stored.scope as HeaderScope)
        : fallback.scope,
      value: typeof stored.value === "string" ? stored.value : fallback.value,
    };
    if (def.id === "content_security_policy") {
      entry.mode = stored.mode === "report-only" ? "report-only" : "enforce";
    }
    if (def.id === "strict_transport_security") {
      entry.onlyWhenSecure = stored.onlyWhenSecure !== false;
    }
    headers[def.id] = entry;
  }

  const custom = Array.isArray(input.custom)
    ? input.custom
        .filter((h): h is CustomHeader => !!h && typeof h.name === "string" && typeof h.value === "string")
        .map((h) => ({
          name: h.name,
          value: h.value,
          enabled: h.enabled !== false,
          scope: (HEADER_SCOPES as readonly string[]).includes(h.scope) ? h.scope : "all",
        }))
    : [];

  return { headers, custom, removeServerHeader: input.removeServerHeader === true };
}

// ─── Resolving a request to actual headers ───────────────────────────────────

export type RequestArea = "admin" | "public";

export type ResolveContext = {
  area: RequestArea;
  /** Whether the request reached us over TLS (directly or via a proxy). */
  secure: boolean;
};

function scopeMatches(scope: HeaderScope, area: RequestArea): boolean {
  return scope === "all" || scope === area;
}

/**
 * Turn a configuration into the concrete header list for one request.
 * Returns an ordered array so the caller can apply it without re-sorting.
 */
export function resolveHeaders(
  config: SecurityHeadersConfig,
  ctx: ResolveContext,
): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];

  for (const def of SECURITY_HEADER_DEFS) {
    const entry = config.headers[def.id];
    if (!entry?.enabled) continue;
    if (!scopeMatches(entry.scope, ctx.area)) continue;

    const value = entry.value.trim();
    if (!value) continue;

    if (def.id === "strict_transport_security" && entry.onlyWhenSecure && !ctx.secure) continue;

    const name =
      def.id === "content_security_policy" && entry.mode === "report-only"
        ? "Content-Security-Policy-Report-Only"
        : def.header;

    out.push({ name, value });
  }

  for (const custom of config.custom) {
    if (!custom.enabled) continue;
    if (!scopeMatches(custom.scope, ctx.area)) continue;
    const value = custom.value.trim();
    if (!value) continue;
    if (isProtectedHeaderName(custom.name)) continue;
    if (!HEADER_NAME_RE.test(custom.name) || !HEADER_VALUE_RE.test(value)) continue;
    out.push({ name: custom.name, value });
  }

  return out;
}

// ─── Storage, with jf-cache on the hot path ─────────────────────────────────

const CACHE_TTL_SECONDS = 30;
/** A failed read usually means "not installed yet"; retry sooner than a hit. */
const CACHE_TTL_ERROR_SECONDS = 5;

const SECURITY_HEADERS_CACHE_KEY = "security-headers:config";

export function invalidateSecurityHeadersCache(): void {
  void getJfCache().delete(SECURITY_HEADERS_CACHE_KEY);
}

async function loadSecurityHeadersFromDb(): Promise<SecurityHeadersConfig> {
  const siteId = await getSiteId();
  if (!siteId) return defaultConfig();
  const stored = await getSiteSetting<unknown>(siteId, SECURITY_HEADERS_SETTING_KEY);
  return normalizeConfig(stored);
}

/**
 * Read the active configuration. Hot path: this runs on every request, so it is
 * served from jf-cache and never lets a database problem turn into a failed
 * response — a broken read falls back to the shipped defaults.
 */
export async function getSecurityHeadersConfig(): Promise<SecurityHeadersConfig> {
  const cache = getJfCache();

  try {
    return await cache.remember(
      SECURITY_HEADERS_CACHE_KEY,
      CACHE_TTL_SECONDS,
      loadSecurityHeadersFromDb,
    );
  } catch {
    try {
      return await cache.remember(
        SECURITY_HEADERS_CACHE_KEY,
        CACHE_TTL_ERROR_SECONDS,
        async () => defaultConfig(),
      );
    } catch {
      return defaultConfig();
    }
  }
}

export async function saveSecurityHeadersConfig(config: SecurityHeadersConfig): Promise<void> {
  const siteId = await getSiteId();
  if (!siteId) throw new Error("No site found");
  await setSiteSetting(siteId, SECURITY_HEADERS_SETTING_KEY, config);
  invalidateSecurityHeadersCache();
}
