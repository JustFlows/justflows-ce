import { z } from "zod";
import { gplLicenseValidationMessage, isGplCompatibleLicense } from "./license.js";
import type {
  ActionName,
  ActionHandlerFor,
  ActionPayload,
  FilterName,
  FilterHandlerFor,
  FilterValue,
  FilterContext,
  GateName,
  GateHandlerFor,
  HookRegisterOptions,
  Unsubscribe,
} from "./hooks.js";

// ─── Plugin manifest ──────────────────────────────────────────────────────

export const PluginPermissionSchema = z.enum([
  "content:read",
  "content:create",
  "content:update",
  "content:delete",
  "content:publish",
  "content:revisions:read",
  "content:revisions:restore",
  "content:revisions:discard",
  "media:read",
  "media:upload",
  "media:delete",
  "users:read",
  "users:manage",
  "settings:read",
  "settings:manage",
  "network:outbound",
  "admin:extend",
  "jobs:register",
  "auth:hook",
]);

export type PluginPermission = z.infer<typeof PluginPermissionSchema>;

export const SENSITIVE_PERMISSIONS: PluginPermission[] = [
  "network:outbound",
  "users:manage",
  "settings:manage",
  "auth:hook",
];

// ─── Admin menu contributions ─────────────────────────────────────────────

/** Sidebar groups an extension may contribute an admin page to. */
export const ADMIN_MENU_DOMAINS = [
  "content",
  "appearance",
  "extensions",
  "security",
  "system",
] as const;

export type AdminMenuDomain = (typeof ADMIN_MENU_DOMAINS)[number];

/**
 * One admin navigation entry owned by a plugin. The host renders these only
 * while the plugin is installed, so uninstalling a plugin takes its pages out
 * of the sidebar with it.
 */
export const AdminMenuItemSchema = z.object({
  /** Unique within the plugin — used as the nav key and for de-duplication. */
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Menu id must be lowercase kebab-case"),
  /** English label, shown when `labelKey` is absent or untranslated. */
  label: z.string().min(1).max(60),
  /** Optional admin i18n catalog key, e.g. "nav.analytics". */
  labelKey: z.string().max(120).optional(),
  /** Admin application path. Must live under /admin/ — the host serves nothing else. */
  path: z.string().regex(/^\/admin\/[a-z0-9][a-z0-9\-/]*$/, "Menu path must be an /admin/… route"),
  icon: z.string().min(1).max(8).default("🔌"),
  domain: z.enum(ADMIN_MENU_DOMAINS).default("extensions"),
  /** Match the path exactly instead of as a prefix. */
  end: z.boolean().optional(),
});

export type PluginAdminMenuItem = z.infer<typeof AdminMenuItemSchema>;

export const PluginManifestSchema = z
  .object({
    id: z
      .string()
      .regex(
        /^[a-z0-9]+(?:\.[a-z0-9-]+)+$/,
        "Plugin ID must be dot-separated namespaced, e.g. acme.my-plugin",
      ),
    name: z.string().min(1).max(100),
    // Anchored at both ends: `.regex()` runs RegExp.test(), which honours only
    // the `^`, so a pattern stopping at the patch number leaves everything after
    // it unconstrained. Nothing joins this value into a path today — the
    // matching field on PackageManifestSchema did, which is how that became a
    // traversal — so keep the two schemas agreeing on what a version is.
    version: z
      .string()
      .max(64)
      .regex(
        /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
        "Must be semver, e.g. 1.2.3 or 1.2.3-rc.1",
      ),
    description: z.string().max(500).optional(),
    author: z.string().optional(),
    homepage: z.url().optional(),
    license: z.string().min(1, "Plugin license is required and must be GPL-compatible"),
    minJustflowsVersion: z.string().optional(),
    maxJustflowsVersion: z.string().optional(),
    permissions: z.array(PluginPermissionSchema).default([]),
    main: z.string().default("index.js"),
    settingsSchema: z
      .record(
        z.string(),
        z.object({
          type: z.enum(["string", "number", "boolean", "text"]),
          label: z.string().min(1),
          description: z.string().optional(),
          default: z.unknown().optional(),
          localized: z.boolean().optional(),
        }),
      )
      .optional(),
    /**
     * Admin pages this plugin adds to the sidebar. Honoured only when the
     * manifest also declares the "admin:extend" permission.
     */
    adminMenu: z.array(AdminMenuItemSchema).max(10).optional(),
  })
  .superRefine((manifest, ctx) => {
    if (manifest.adminMenu?.length && !manifest.permissions.includes("admin:extend")) {
      ctx.addIssue({
        code: "custom",
        path: ["adminMenu"],
        message: 'Contributing admin menu items requires the "admin:extend" permission',
      });
    }
    if (!isGplCompatibleLicense(manifest.license)) {
      ctx.addIssue({
        code: "custom",
        path: ["license"],
        message: gplLicenseValidationMessage(manifest.license),
      });
    }
  });

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

// ─── Plugin cache API ──────────────────────────────────────────────────────

/**
 * Namespaced access to the shared jf-cache. Every key is stored under
 * `plugin:{pluginId}:…` so plugins cannot read or wipe core / other-plugin keys.
 */
export interface PluginCacheApi {
  readonly enabled: boolean;

  /** Read-through cache with in-flight deduplication. */
  remember<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T>;

  get<T = unknown>(key: string): Promise<T | undefined>;

  set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;

  delete(key: string): Promise<void>;

  /**
   * Invalidate keys under this plugin's namespace.
   * Pass a relative prefix (e.g. `"products:"`) or omit to clear the whole plugin tree.
   */
  invalidate(prefix?: string): Promise<void>;
}

/** The signed-in user behind a plugin request, when there is one. */
export interface PluginHttpSession {
  userId: string;
  siteId: string;
  role: string;
  email: string;
}

export interface PluginHttpRequest {
  method: "GET" | "POST";
  path: string;
  query: Record<string, string>;
  body: unknown;
  /**
   * Request headers, with `cookie` and `authorization` removed — a plugin route
   * has no reason to read the session cookie, and handing it over made every
   * installed plugin a credential holder. Use `session` for identity.
   */
  headers: Record<string, string>;
  /**
   * The caller's session, or null when anonymous.
   *
   * Plugin routes are public unless the handler checks this. There was no way to
   * check at all before, so every plugin endpoint was unauthenticated by
   * construction, whatever its author intended.
   */
  session: PluginHttpSession | null;
}

export interface PluginHttpResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer | Record<string, unknown> | unknown[];
  type?: string;
}

export type PluginHttpHandler = (
  req: PluginHttpRequest,
) => PluginHttpResponse | Promise<PluginHttpResponse>;

export interface PluginHttpApi {
  get(path: string, handler: PluginHttpHandler): void;
  post(path: string, handler: PluginHttpHandler): void;
}

export interface PluginDataRecord<T = unknown> {
  id: string;
  data: T;
  createdAt: string;
  updatedAt: string;
}

export interface PluginDataApi {
  list<T = unknown>(collection: string): Promise<PluginDataRecord<T>[]>;
  get<T = unknown>(collection: string, id: string): Promise<PluginDataRecord<T> | undefined>;
  put<T = unknown>(collection: string, id: string, data: T): Promise<void>;
  delete(collection: string, id: string): Promise<void>;
}

export interface PluginBlockDefinition {
  type: string;
  version: number;
  title: string;
  description?: string;
  icon?: string;
  category?: string;
  schema: Record<
    string,
    { type: string; required?: boolean; default?: unknown; options?: string[] }
  >;
  supportsChildren?: boolean;
  allowedChildTypes?: string[];
  render(props: Record<string, unknown>, children?: string): string;
  validateProps(raw: unknown): Record<string, unknown>;
}

export interface PluginBlocksApi {
  register(definition: PluginBlockDefinition): void;
}

// ─── Plugin API surface ────────────────────────────────────────────────────

/**
 * The context object injected into every plugin's activate() function.
 * Extensions import this type from @justflows/sdk — never from @justflows/core.
 */
export interface PluginContext {
  readonly pluginId: string;
  readonly version: string;
  readonly permissions: ReadonlySet<PluginPermission>;

  /**
   * Shared jf-cache, scoped to this plugin. Always available; when caching is
   * disabled globally, reads miss and writes are no-ops (same as core).
   */
  cache: PluginCacheApi;

  /**
   * Typed hook registration. Hook names autocomplete, payloads infer, and a
   * wrong handler signature fails at compile time. Every registration is owned
   * by this plugin and removed automatically on deactivation.
   */
  hooks: {
    /** Observe an event. Failures are isolated and attributed to this plugin. */
    action<K extends ActionName>(
      hook: K,
      handler: ActionHandlerFor<K>,
      options?: HookRegisterOptions,
    ): Unsubscribe;

    /**
     * Validate a pending operation. Call `event.cancel(reason)` to block it.
     * Gates fail closed — throwing also aborts the operation.
     */
    gate<K extends GateName>(
      hook: K,
      handler: GateHandlerFor<K>,
      options?: HookRegisterOptions,
    ): Unsubscribe;

    /** Transform a value. Handlers must return the next value. */
    filter<K extends FilterName>(
      hook: K,
      handler: FilterHandlerFor<K>,
      options?: HookRegisterOptions,
    ): Unsubscribe;

    /** Emit a hook owned by this plugin. Names outside its namespace are rejected. */
    emit<K extends ActionName>(hook: K, event: ActionPayload<K>): Promise<void>;

    /** Apply a filter owned by this plugin. Names outside its namespace are rejected. */
    apply<K extends FilterName>(
      hook: K,
      value: FilterValue<K>,
      context: FilterContext<K>,
    ): Promise<FilterValue<K>>;

    /** True when anything is listening — use to skip expensive payload work. */
    has(hook: string): boolean;
  };

  settings: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set<T = unknown>(key: string, value: T): Promise<void>;
  };

  /** Plugin-owned public HTTP routes. Paths starting with `/` claim a site-root path. */
  http: PluginHttpApi;

  /** Plugin-scoped JSON documents. No raw SQL. */
  data: PluginDataApi;

  /** Register block types for the editor and public renderer. Removed on deactivate. */
  blocks: PluginBlocksApi;

  logger: {
    debug(message: string, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    error(message: string, context?: Record<string, unknown>): void;
  };
}

/**
 * A Justflows plugin module must export an object matching this interface.
 */
export interface PluginModule {
  manifest: PluginManifest;
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(ctx: PluginContext): void | Promise<void>;
}
