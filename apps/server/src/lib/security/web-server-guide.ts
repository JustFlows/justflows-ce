// SPDX-License-Identifier: MIT

import fs from "node:fs/promises";
import path from "node:path";
import { uploadsDir, getJfRoot } from "../runtime/jf-root.js";
import { isInstallationRootRequest } from "../tenancy/access.js";
import { renderRootHtaccess, ROOT_HTACCESS_FILE } from "./root-htaccess.js";

/**
 * Copy-paste web server files for this install.
 *
 * The process can refresh the site-root `.htaccess`. nginx, an Apache reverse
 * proxy, Passenger, and Docker are not rewritten from here, so the page shows
 * the file an administrator pastes into that host.
 */

export const WEB_SERVER_ENVIRONMENT_IDS = [
  "application",
  "apache",
  "nginx",
  "apacheProxy",
  "passenger",
  "docker",
] as const;

export type WebServerEnvironmentId = (typeof WEB_SERVER_ENVIRONMENT_IDS)[number];
export type HtaccessState = "current" | "pending" | "custom" | "missing";

export interface WebServerEnvironment {
  id: WebServerEnvironmentId;
  /** True when this process already applies the file for that host. */
  automatic: boolean;
  config: string | null;
}

export interface WebServerGuide {
  installationRoot: boolean;
  htaccess: HtaccessState;
  accelConfigured: boolean;
  environments: WebServerEnvironment[];
}

export interface WebServerGuideInput {
  installationRoot: boolean;
  htaccess: HtaccessState;
  port: string | undefined;
  uploadsDir: string;
  accelPrefix: string | undefined;
  htaccessBody: string;
}

/** Compare the site-root file with the managed body. Does not write it. */
export async function readRootHtaccessState(root: string, expected: string): Promise<HtaccessState> {
  let existing: string;
  try {
    existing = await fs.readFile(path.join(root, ROOT_HTACCESS_FILE), "utf8");
  } catch {
    return "missing";
  }
  const expectedFirst = expected.split("\n", 1)[0]?.trim() ?? "";
  const first = existing.split("\n", 1)[0]?.trim() ?? "";
  if (!expectedFirst || first !== expectedFirst) return "custom";
  return existing === expected ? "current" : "pending";
}

function listenPort(raw: string | undefined): string {
  const port = Number(raw ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "3000";
  return String(port);
}

/** Absolute uploads directory for an nginx `alias`, or null when it cannot be pasted safely. */
export function uploadsAlias(dir: string): string | null {
  const resolved = path.resolve(dir).replace(/\\/g, "/");
  if (/[\r\n";{}]/.test(resolved)) return null;
  return resolved.endsWith("/") ? resolved : `${resolved}/`;
}

function accelLocation(raw: string | undefined): string {
  const value = (raw ?? "").trim().replace(/\/$/, "");
  if (!value) return "/internal-uploads";
  if (!/^\/[A-Za-z0-9._/-]+$/.test(value) || value.includes("..")) return "/internal-uploads";
  return value;
}

/** nginx locations for `/uploads/` and the optional internal handoff. */
export function renderNginxUploads(port: string, alias: string | null, accel: string): string {
  const handoff = alias
    ? `# Optional offload. Set UPLOADS_ACCEL_REDIRECT=${accel} and restart the app
# only after this location is in the same server block.
# \`internal\` means a browser cannot request this location.
location ${accel}/ {
    internal;
    alias ${alias};
}`
    : `# Optional offload. The uploads path could not be written here.
# Add an internal location whose alias is the uploads directory, then set
# UPLOADS_ACCEL_REDIRECT to that location and restart the app.`;
  return `# Paste inside the server block that already proxies this site to Justflows.
# Remove any alias or root that serves /uploads/ from disk.

location /uploads/ {
    proxy_pass http://127.0.0.1:${port};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

${handoff}
`;
}

/** Apache lines that send `/uploads/` to the app instead of an Alias. */
export function renderApacheProxy(port: string): string {
  return `# Paste before a broader ProxyPass / line.
# Do not Alias /uploads to the uploads directory.

ProxyPass        /uploads/ http://127.0.0.1:${port}/uploads/
ProxyPassReverse /uploads/ http://127.0.0.1:${port}/uploads/
`;
}

function emptyGuide(): WebServerGuide {
  return { installationRoot: false, htaccess: "missing", accelConfigured: false, environments: [] };
}

export function buildWebServerGuide(input: WebServerGuideInput): WebServerGuide {
  if (!input.installationRoot) return emptyGuide();
  const port = listenPort(input.port);
  const alias = uploadsAlias(input.uploadsDir);
  const accel = accelLocation(input.accelPrefix);
  const nginx = renderNginxUploads(port, alias, accel);
  const htaccessAutomatic = input.htaccess === "current" || input.htaccess === "pending";
  return {
    installationRoot: true,
    htaccess: input.htaccess,
    accelConfigured: Boolean(input.accelPrefix?.trim()),
    environments: [
      { id: "application", automatic: true, config: null },
      { id: "apache", automatic: htaccessAutomatic, config: input.htaccessBody },
      { id: "nginx", automatic: false, config: nginx },
      { id: "apacheProxy", automatic: false, config: renderApacheProxy(port) },
      { id: "passenger", automatic: htaccessAutomatic, config: null },
      { id: "docker", automatic: false, config: nginx },
    ],
  };
}

export async function loadWebServerGuide(): Promise<WebServerGuide> {
  if (!isInstallationRootRequest()) return emptyGuide();
  const htaccessBody = renderRootHtaccess();
  const htaccess = await readRootHtaccessState(getJfRoot(), htaccessBody);
  return buildWebServerGuide({
    installationRoot: true,
    htaccess,
    port: process.env.PORT,
    uploadsDir: uploadsDir(),
    accelPrefix: process.env.UPLOADS_ACCEL_REDIRECT,
    htaccessBody,
  });
}
