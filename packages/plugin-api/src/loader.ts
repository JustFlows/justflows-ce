import {
  PluginManifestSchema,
  requiredPermissionForHook,
  isOwnedHookName,
  type PluginManifest,
  type PluginModule,
  type PluginContext,
  type PluginPermission,
  type PluginCacheApi,
  type PluginDataApi,
  type PluginBlockDefinition,
  type HookRegisterOptions,
  type Unsubscribe,
} from "@justflows/sdk";
import type { App } from "@justflows/core";
import { PluginHttpRouter } from "./http-router.js";

export interface LoadedPlugin {
  manifest: PluginManifest;
  module: PluginModule;
  state: "inactive" | "active" | "error";
  error?: Error;
}

export type PluginCacheFactory = (pluginId: string) => PluginCacheApi;
export type PluginDataFactory = (pluginId: string, siteId: string) => PluginDataApi;
export type PluginSettingsAdapter = {
  get<T = unknown>(siteId: string, key: string): Promise<T | undefined>;
  set<T = unknown>(siteId: string, key: string, value: T): Promise<void>;
};

export interface PluginBlockRegistry {
  register(definition: PluginBlockDefinition): void;
  unregister(type: string): void;
}

const NULL_CACHE: PluginCacheApi = {
  enabled: false,
  remember: async (_key, _ttl, fn) => fn(),
  get: async () => undefined,
  set: async () => undefined,
  delete: async () => undefined,
  invalidate: async () => undefined,
};

const NULL_DATA: PluginDataApi = {
  list: async () => [],
  get: async () => undefined,
  put: async () => undefined,
  delete: async () => undefined,
};

export class PluginLoader {
  private readonly plugins = new Map<string, LoadedPlugin>();
  private readonly cacheFactory: PluginCacheFactory;
  private readonly dataFactory: PluginDataFactory;
  private readonly settingsAdapter: PluginSettingsAdapter;
  private readonly blockRegistry: PluginBlockRegistry | undefined;
  private readonly registeredBlocks = new Map<string, string[]>();
  readonly httpRouter: PluginHttpRouter;

  constructor(
    private readonly app: App,
    options?: {
      cacheFactory?: PluginCacheFactory;
      dataFactory?: PluginDataFactory;
      settingsAdapter?: PluginSettingsAdapter;
      httpRouter?: PluginHttpRouter;
      blockRegistry?: PluginBlockRegistry;
    },
  ) {
    this.cacheFactory = options?.cacheFactory ?? (() => NULL_CACHE);
    this.dataFactory = options?.dataFactory ?? (() => NULL_DATA);
    this.settingsAdapter = options?.settingsAdapter ?? {
      get: (siteId, key) => this.app.settings.get(siteId, key),
      set: (siteId, key, value) => this.app.settings.set(siteId, key, value),
    };
    this.httpRouter = options?.httpRouter ?? new PluginHttpRouter();
    this.blockRegistry = options?.blockRegistry;
  }

  /**
   * Register a plugin module directly (for local/in-process plugins).
   * In Phase 9+ this will also support loading from .jfpkg archives.
   */
  register(pluginModule: PluginModule): void {
    const parsed = PluginManifestSchema.safeParse(pluginModule.manifest);
    if (!parsed.success) {
      throw new Error(
        `Invalid plugin manifest for "${String(pluginModule.manifest.id)}":\n${parsed.error.message}`,
      );
    }

    const manifest = parsed.data;

    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin "${manifest.id}" is already registered`);
    }

    this.plugins.set(manifest.id, {
      manifest,
      module: pluginModule,
      state: "inactive",
    });

    this.app.logger.info("Plugin registered", {
      pluginId: manifest.id,
      version: manifest.version,
    });
  }

  async activate(pluginId: string, siteId: string): Promise<void> {
    const entry = this.plugins.get(pluginId);
    if (!entry) throw new Error(`Plugin "${pluginId}" is not registered`);
    if (entry.state === "active") return;

    const ctx = this.buildContext(entry.manifest, siteId);

    try {
      await entry.module.activate(ctx);
      entry.state = "active";
      this.app.logger.info("Plugin activated", { pluginId, version: entry.manifest.version });
      await this.app.hooks.dispatchAction(
        "plugin.activated",
        { pluginId, version: entry.manifest.version, siteId },
        { siteId, source: "system" },
      );
    } catch (err) {
      this.cleanupPlugin(pluginId);
      entry.state = "error";
      entry.error = err instanceof Error ? err : new Error(String(err));
      this.app.logger.error("Plugin activation failed", { pluginId, error: String(err) });
      throw err;
    }
  }

  async deactivate(pluginId: string, siteId: string): Promise<void> {
    const entry = this.plugins.get(pluginId);
    if (!entry || entry.state !== "active") return;

    const ctx = this.buildContext(entry.manifest, siteId);

    try {
      await entry.module.deactivate?.(ctx);
    } catch (err) {
      this.app.logger.warn("Plugin deactivate() threw", { pluginId, error: String(err) });
    }

    this.cleanupPlugin(pluginId);
    entry.state = "inactive";

    this.app.logger.info("Plugin deactivated", { pluginId });
    await this.app.hooks.dispatchAction(
        "plugin.deactivated",
        { pluginId, version: entry.manifest.version, siteId },
        { siteId, source: "system" },
      );
  }

  getPlugin(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  listPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  private cleanupPlugin(pluginId: string): void {
    this.app.hooks.removePlugin(pluginId);
    this.httpRouter.removePlugin(pluginId);
    const types = this.registeredBlocks.get(pluginId) ?? [];
    for (const type of types) this.blockRegistry?.unregister(type);
    this.registeredBlocks.delete(pluginId);
  }

  private buildContext(manifest: PluginManifest, siteId: string): PluginContext {
    const pluginId = manifest.id;
    const permissions = new Set(manifest.permissions);
    const logger = this.app.logger.child({ pluginId });
    const settings = this.settingsAdapter;
    const hooks = this.app.hooks;
    const cache = this.cacheFactory(pluginId);
    const data = this.dataFactory(pluginId, siteId);

    /**
     * Listening on a sensitive namespace requires the matching manifest
     * permission. This fails loudly at activation rather than silently at
     * runtime, so a mis-declared plugin never half-works in production.
     */
    const assertMayListen = (hook: string): void => {
      const required = requiredPermissionForHook(hook);
      if (required === null) return;
      if (permissions.has(required as PluginPermission)) return;
      throw new Error(
        `Plugin "${pluginId}" cannot register on "${hook}" without the ` +
          `"${required}" permission. Add it to the plugin manifest.`,
      );
    };

    /** A plugin may only emit hooks inside its own namespace. */
    const assertMayEmit = (hook: string): void => {
      if (isOwnedHookName(pluginId, hook)) return;
      throw new Error(
        `Plugin "${pluginId}" cannot emit "${hook}" — plugins may only emit ` +
          `hooks under their own namespace ("${pluginId}.*").`,
      );
    };

    const register = (
      kind: "action" | "gate" | "filter",
      hook: string,
      handler: unknown,
      options: HookRegisterOptions | undefined,
    ): Unsubscribe => {
      assertMayListen(hook);
      const opts = { ...options, pluginId };
      if (kind === "filter") {
        return hooks.filter(hook, handler as never, opts);
      }
      return hooks.action(hook, handler as never, opts);
    };

    return {
      pluginId,
      version: manifest.version,
      permissions,
      cache,
      hooks: {
        action: (hook, handler, options) => register("action", hook, handler, options),
        gate: (hook, handler, options) => register("gate", hook, handler, options),
        filter: (hook, handler, options) => register("filter", hook, handler, options),
        emit: async (hook, event) => {
          assertMayEmit(hook);
          await hooks.dispatchAction(hook, event, { siteId, source: "system" });
        },
        apply: async (hook, value, context) => {
          assertMayEmit(hook);
          return hooks.applyFilter(hook, value, context, { siteId, source: "system" });
        },
        has: (hook) => hooks.has(hook),
      },
      settings: {
        get: (key) => settings.get(siteId, `${pluginId}:${key}`),
        set: (key, value) => settings.set(siteId, `${pluginId}:${key}`, value),
      },
      http: {
        get: (path, handler) => this.httpRouter.register(pluginId, "GET", path, handler),
        post: (path, handler) => this.httpRouter.register(pluginId, "POST", path, handler),
      },
      data,
      blocks: {
        register: (definition) => {
          if (!definition.type.startsWith(`${pluginId}.`) && definition.type !== pluginId) {
            throw new Error(
              `Plugin "${pluginId}" can only register blocks under its own namespace`,
            );
          }
          this.blockRegistry?.register(definition);
          const types = this.registeredBlocks.get(pluginId) ?? [];
          types.push(definition.type);
          this.registeredBlocks.set(pluginId, types);
        },
      },
      logger,
    };
  }
}
