// SPDX-License-Identifier: MIT

import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Request, Response } from "express";
import { getJfRoot } from "../runtime/jf-root.js";
import { logSafe } from "../security/log-safe.js";
import { ADMIN_UI_LOCALES } from "../i18n/locales.js";

interface SerializedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

interface AdminSsrPayload {
  url: string;
  locale: string;
  adminBasePath: string;
  responses: Record<string, SerializedResponse>;
}

type RenderAdmin = (url: string, payload: AdminSsrPayload) => string;

const ADMIN_LOCALES = ADMIN_UI_LOCALES;
const SCRIPT_UNSAFE = /[<>&\u2028\u2029]/g;

function adminUiDist(): string {
  const root = getJfRoot();
  const candidates = [
    path.join(root, "apps/server/admin-ui/dist"),
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../admin-ui/dist"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]!;
}

export function adminClientDir(): string {
  return path.join(adminUiDist(), "client");
}

export function adminClientIndex(): string {
  return path.join(adminClientDir(), "index.html");
}

function adminServerEntry(): string {
  return path.join(adminUiDist(), "server", "entry-server.js");
}

export function serializeAdminSsrData(value: unknown): string {
  return JSON.stringify(value).replace(
    SCRIPT_UNSAFE,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function preferredLocale(req: Request): string {
  const cookieLocale =
    typeof req.cookies?.jf_locale === "string" ? (req.cookies.jf_locale.split("-")[0] ?? "") : "";
  if ((ADMIN_LOCALES as readonly string[]).includes(cookieLocale)) return cookieLocale;
  const language = req.acceptsLanguages(...ADMIN_LOCALES);
  return typeof language === "string" ? language : "en";
}

export function adminPrefetchPaths(originalUrl: string): string[] {
  const url = new URL(originalUrl, "http://justflows.local");
  const pathname = url.pathname.replace(/\/$/, "") || "/";
  const paths = new Set<string>([
    "/api/site/identity",
    "/api/updates",
    "/api/plugins/admin-menu",
    "/api/auth/me",
    ...ADMIN_LOCALES.map((locale) => `/api/i18n/${locale}`),
  ]);
  if (url.searchParams.get("preview") === "1") paths.add("/api/site/identity?preview=1");

  if (pathname === "/admin") return [...paths];
  if (pathname === "/admin/content") {
    paths.add("/api/languages");
    paths.add("/api/settings");
    paths.add("/api/content-types");
  } else if (pathname === "/admin/content/new") {
    const type = url.searchParams.get("type") ?? "post";
    paths.add("/api/languages/active");
    paths.add(`/api/content-types/${encodeURIComponent(type)}`);
  } else if (/^\/admin\/content\/[^/]+\/builder$/.test(pathname)) {
    const id = pathname.split("/")[3]!;
    paths.add(`/api/content/${encodeURIComponent(id)}`);
    paths.add("/api/blocks");
    paths.add("/api/menus");
    paths.add("/api/headers/options");
    paths.add("/api/reusable-blocks");
    paths.add("/api/themes/patterns");
  } else if (/^\/admin\/content\/[^/]+$/.test(pathname)) {
    const id = pathname.split("/")[3]!;
    paths.add("/api/languages/active");
    paths.add("/api/settings");
    paths.add("/api/headers/options");
    paths.add(`/api/content/${encodeURIComponent(id)}`);
  } else if (pathname === "/admin/content-types") {
    paths.add("/api/content-types");
  } else if (pathname === "/admin/media") {
    paths.add("/api/media");
  } else if (pathname === "/admin/plugins") {
    paths.add("/api/plugins");
  } else if (/^\/admin\/plugins\/[^/]+\/settings$/.test(pathname)) {
    const id = pathname.split("/")[3]!;
    paths.add(`/api/plugins/${encodeURIComponent(id)}/settings`);
  } else if (pathname === "/admin/themes") {
    paths.add("/api/themes");
  } else if (pathname === "/admin/themes/customize") {
    paths.add("/api/template-parts/footer");
    paths.add("/api/headers");
    paths.add("/api/menus");
    paths.add("/api/site/identity");
    paths.add("/api/languages/active");
    paths.add("/api/themes/customize");
  } else if (pathname === "/admin/design") {
    paths.add("/api/css-providers");
  } else if (pathname === "/admin/menus") {
    paths.add("/api/menus");
    paths.add("/api/languages");
    paths.add("/api/content-types");
  } else if (pathname === "/admin/users") {
    paths.add("/api/users");
  } else if (pathname === "/admin/settings") {
    paths.add("/api/settings");
  } else if (pathname === "/admin/comments") {
    paths.add("/api/comments?status=pending");
  } else if (pathname === "/admin/marketplace") {
    paths.add("/api/marketplace");
    paths.add("/api/plugins");
    paths.add("/api/themes");
  } else if (pathname === "/admin/tools") {
    paths.add("/api/performance/settings");
    paths.add("/api/cache/settings");
    paths.add("/api/performance/stats");
    paths.add("/api/cache/stats");
  } else if (pathname === "/admin/health") {
    paths.add("/api/diagnostics");
  } else if (pathname === "/admin/platform/workspaces" || pathname === "/admin/platform/sites") {
    paths.add("/api/platform/overview");
  } else if (pathname === "/admin/platform/defaults") {
    paths.add("/api/platform/quota-defaults");
  } else if (/^\/admin\/platform\/workspaces\/[^/]+$/.test(pathname)) {
    const id = pathname.split("/")[4] ?? "";
    paths.add(`/api/platform/tenants/${encodeURIComponent(id)}`);
  } else if (/^\/admin\/platform\/sites\/[^/]+\/users$/.test(pathname)) {
    const id = pathname.split("/")[4] ?? "";
    paths.add(`/api/platform/sites/${encodeURIComponent(id)}/users`);
  } else if (/^\/admin\/platform\/sites\/[^/]+$/.test(pathname)) {
    const id = pathname.split("/")[4] ?? "";
    paths.add(`/api/platform/sites/${encodeURIComponent(id)}`);
  } else if (pathname === "/admin/languages") {
    paths.add("/api/languages");
  } else if (
    pathname === "/admin/security" ||
    pathname === "/admin/security/headers" ||
    pathname === "/admin/security/advanced"
  ) {
    paths.add("/api/security/headers");
  } else if (pathname === "/admin/security/admin-path") {
    paths.add("/api/security/admin-path");
  } else if (pathname === "/admin/security/account") {
    paths.add("/api/auth/2fa");
  } else if (pathname === "/admin/security/audit") {
    paths.add("/api/audit");
  }
  return [...paths];
}

/**
 * Host header for a loopback prefetch.
 *
 * The connection stays on 127.0.0.1, but that name is not a site once a
 * second hostname exists. The prefetch has to present the same Host the
 * browser used, or `/api/auth/me` 404s and the admin sidebar renders with
 * no role.
 */
export function ssrPrefetchHost(hostname: string, hostHeader: string | undefined): string {
  const header = hostHeader?.split(",")[0]?.trim() ?? "";
  if (!hostname) return header || "127.0.0.1";
  const port = header.startsWith("[") ? "" : (header.match(/:(\d+)$/)?.[1] ?? "");
  if (!port || port === "80" || port === "443") return hostname;
  return `${hostname}:${port}`;
}

async function fetchOne(
  origin: string,
  requestPath: string,
  cookie: string,
  host: string,
): Promise<SerializedResponse> {
  const url = new URL(requestPath, origin);
  const transport = url.protocol === "https:" ? https : http;
  return await new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          accept: "application/json",
          cookie,
          host,
        },
        timeout: 10_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const headers: Record<string, string> = {};
          const contentType = response.headers["content-type"];
          if (typeof contentType === "string") headers["content-type"] = contentType;
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? "",
            headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("SSR prefetch timed out")));
    req.end();
  });
}

async function addDerivedResponses(
  req: Request,
  origin: string,
  host: string,
  responses: Record<string, SerializedResponse>,
): Promise<void> {
  const pathname = new URL(req.originalUrl, "http://justflows.local").pathname;
  const derived = new Set<string>();
  const read = <T>(key: string): T | undefined => {
    try {
      return JSON.parse(responses[key]?.body ?? "") as T;
    } catch {
      return undefined;
    }
  };

  if (pathname === "/admin/content") {
    // Admin content list spans every language; the site's default
    // published locale must never gate what admins can see here.
    derived.add("/api/content");
  }
  if (/^\/admin\/content\/[^/]+$/.test(pathname)) {
    const id = pathname.split("/")[3]!;
    const content = read<{ type?: string; translationGroupId?: string }>(
      `/api/content/${encodeURIComponent(id)}`,
    );
    if (content?.type) derived.add(`/api/content-types/${encodeURIComponent(content.type)}`);
    if (content?.translationGroupId) {
      derived.add(
        `/api/content?translationGroupId=${encodeURIComponent(content.translationGroupId)}&limit=20`,
      );
    }
  }
  if (pathname === "/admin/menus") {
    const menus = read<{ menus?: Array<{ slug?: string }> }>("/api/menus");
    const slug = menus?.menus?.[0]?.slug;
    if (slug) derived.add(`/api/menus/${encodeURIComponent(slug)}`);
    // The "add items" content picker spans every language too — see
    // the /admin/content note above.
    const types = read<{ types?: Array<{ slug?: string }> }>("/api/content-types");
    const slugs = (types?.types ?? [])
      .map((type) => type.slug)
      .filter((slug): slug is string => Boolean(slug));
    const list = slugs.length > 0 ? slugs : ["page", "post"];
    for (const type of list) {
      derived.add(`/api/content?type=${encodeURIComponent(type)}&status=published&limit=100`);
    }
  }
  const cookie = req.get("cookie") ?? "";
  await Promise.all(
    [...derived].map(async (requestPath) => {
      try {
        responses[requestPath] = await fetchOne(origin, requestPath, cookie, host);
      } catch {
        /* client can recover */
      }
    }),
  );
}

async function buildPayload(req: Request): Promise<AdminSsrPayload> {
  const { getAdminPathConfig, toInternalAdminPath, toPublicAdminPath } =
    await import("./admin-path.js");
  const adminConfig = await getAdminPathConfig();
  const payload: AdminSsrPayload = {
    url: toPublicAdminPath(req.originalUrl, adminConfig.path),
    locale: preferredLocale(req),
    adminBasePath: adminConfig.path,
    responses: {},
  };
  const configuredOrigin = (process.env.APP_URL ?? "").replace(/\/$/, "");
  let origin: string;
  const localPort = req.socket.localPort;
  if (Number.isInteger(localPort) && Number(localPort) > 0) {
    origin = `http://127.0.0.1:${localPort}`;
  } else {
    try {
      origin = new URL(configuredOrigin).origin;
    } catch {
      return payload;
    }
  }
  const cookie = req.get("cookie") ?? "";
  const host = ssrPrefetchHost(req.hostname, req.get("host"));
  await Promise.all(
    adminPrefetchPaths(
      toInternalAdminPath(
        new URL(payload.url, "http://justflows.local").pathname,
        adminConfig.path,
      ) ?? payload.url,
    ).map(async (requestPath) => {
      try {
        payload.responses[requestPath] = await fetchOne(origin, requestPath, cookie, host);
      } catch {
        /* client can recover */
      }
    }),
  );
  await addDerivedResponses(req, origin, host, payload.responses);
  return payload;
}

async function loadRenderer(): Promise<RenderAdmin> {
  const entry = adminServerEntry();
  const module = (await import(pathToFileURL(entry).href)) as { render?: RenderAdmin };
  if (typeof module.render !== "function") throw new Error("Admin SSR bundle has no render export");
  return module.render;
}

export async function renderAdminPage(req: Request, res: Response): Promise<void> {
  try {
    const [template, render, payload] = await Promise.all([
      fsp.readFile(adminClientIndex(), "utf-8"),
      loadRenderer(),
      buildPayload(req),
    ]);
    const appHtml = render(payload.url, payload);
    const adminAssetBase = `${payload.adminBasePath}/assets`;
    const html = template
      .replaceAll('src="/assets/', `src="${adminAssetBase}/`)
      .replaceAll('href="/assets/', `href="${adminAssetBase}/`)
      .replace("<!--ssr-outlet-->", appHtml)
      .replace(
        "<!--ssr-data-->",
        `<script id="jf-ssr-data" type="application/json">${serializeAdminSsrData(payload)}</script>`,
      );
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Vary", "Cookie, Accept-Language");
    res.status(200).type("html").send(html);
  } catch (err) {
    console.error("[justflows] admin SSR failed", JSON.stringify({ path: logSafe(req.path) }), err);
    res.status(503).type("text/plain").send("Admin UI is temporarily unavailable.");
  }
}
