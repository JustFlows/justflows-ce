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
  userMode: UserMode;
  databaseMode: DatabaseMode;
  /** The site created with the installation. Updates, health, and process settings live here. */
  rootSite?: boolean;
  /** Plugin ids active for this site. Null means the allowlist could not be loaded. */
  activePluginIds: Set<string> | null;
}

const storage = new AsyncLocalStorage<TenantRequestContext>();

export function getTenantContext(): TenantRequestContext | undefined {
  return storage.getStore();
}

export function runWithTenant<T>(context: TenantRequestContext, fn: () => T): T {
  return storage.run(context, fn);
}
