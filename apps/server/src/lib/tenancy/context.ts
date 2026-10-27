// SPDX-License-Identifier: MIT

import { AsyncLocalStorage } from "node:async_hooks";

export type TenantStatus = "active" | "suspended" | "provisioning" | "deleted";
export type UserMode = "isolated" | "shared";
export type DatabaseMode = "current" | "separate";
export type DatabaseChoice = "inherit" | "current" | "separate";

export interface TenantRequestContext {
  tenantId: string;
  siteId: string;
  hostname: string;
  /**
   * The request's port on a loopback host (`localhost:3000` in development),
   * so absolute URLs keep it. Never set for public hosts, where a port from
   * the request could poison shared caches.
   */
  devPort?: string;
  userMode: UserMode;
  databaseMode: DatabaseMode;
  /** The site created with the installation. Updates, health, and process settings live here. */
  rootSite?: boolean;
  /** Plugin ids active for this site. Null means the allowlist could not be loaded. */
  activePluginIds: Set<string> | null;
  /**
   * Plugin ids active on the installation's main site. Their `{ network: true }`
   * hook handlers run on this site too. Absent outside a site request.
   */
  networkPluginIds?: Set<string>;
}

const storage = new AsyncLocalStorage<TenantRequestContext>();

export function getTenantContext(): TenantRequestContext | undefined {
  return storage.getStore();
}

const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.localhost)$/i;

/** The port of a loopback `Host` header (`localhost:3000` → `3000`), else undefined. */
export function loopbackPort(hostname: string, hostHeader: string | undefined): string | undefined {
  if (!LOOPBACK_HOST.test(hostname) || !hostHeader) return undefined;
  const match = /:(\d{1,5})$/.exec(hostHeader.trim());
  const port = match?.[1];
  return port && Number(port) > 0 && Number(port) <= 65535 && port !== "80" ? port : undefined;
}

export function runWithTenant<T>(context: TenantRequestContext, fn: () => T): T {
  return storage.run(context, fn);
}
