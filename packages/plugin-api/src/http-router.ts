// SPDX-License-Identifier: MIT

import type { PluginHttpHandler, PluginHttpRequest, PluginHttpResponse } from "@justflows/sdk";

export interface RegisteredPluginRoute {
  pluginId: string;
  method: "GET" | "POST";
  path: string;
  handler: PluginHttpHandler;
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) throw new Error("Plugin HTTP path must not be empty");
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/{2,}/g, "/");
}

export class PluginHttpRouter {
  private readonly routes: RegisteredPluginRoute[] = [];

  register(pluginId: string, method: "GET" | "POST", rawPath: string, handler: PluginHttpHandler): void {
    const path = rawPath.startsWith("/")
      ? normalizePath(rawPath)
      : normalizePath(`/ext/${pluginId}/${rawPath}`);

    const conflict = this.routes.find((route) => route.method === method && route.path === path);
    if (conflict) {
      throw new Error(
        `Plugin "${pluginId}" cannot claim ${method} ${path} — already claimed by "${conflict.pluginId}"`,
      );
    }

    this.routes.push({ pluginId, method, path, handler });
  }

  removePlugin(pluginId: string): void {
    for (let i = this.routes.length - 1; i >= 0; i--) {
      if (this.routes[i]?.pluginId === pluginId) this.routes.splice(i, 1);
    }
  }

  match(method: string, path: string): RegisteredPluginRoute | undefined {
    const normalized = normalizePath(path);
    return this.routes.find((route) => route.method === method && route.path === normalized);
  }

  list(): RegisteredPluginRoute[] {
    return [...this.routes];
  }
}

export type { PluginHttpRequest, PluginHttpResponse };
