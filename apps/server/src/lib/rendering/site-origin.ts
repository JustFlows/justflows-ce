// SPDX-License-Identifier: MIT

import { getTenantContext } from "../tenancy/context.js";

/** Public origin of the site being served. APP_URL stays the installation address. */
export function siteOrigin(): string {
  const context = getTenantContext();
  const host = context?.hostname?.trim().toLowerCase() ?? "";
  if (host && !host.includes("/") && !host.includes(" ")) {
    const secure = host !== "localhost" && !host.startsWith("127.0.0.1") && !host.endsWith(".localhost");
    const port = context?.devPort ? `:${context.devPort}` : "";
    return `${secure ? "https" : "http"}://${host}${port}`;
  }
  return (process.env.APP_URL ?? "").replace(/\/$/, "");
}
