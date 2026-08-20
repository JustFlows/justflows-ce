/**
 * @justflows/sdk — Typed hook contracts
 *
 * This is the stable public contract for plugin and theme developers.
 * Every name and payload shape here is public API under semantic versioning.
 *
 * INTERNAL NOTE: This file must never import from @justflows/core —
 * it is the public surface that extensions depend on.
 */

// ─── Shared context ────────────────────────────────────────────────────────

export type HookSource = "http" | "job" | "cli" | "system";

export interface HookActor {
  readonly userId?: string;
  readonly role?: string;
}

/**
 * Correlation data handed to every handler as the second argument.
 * Identity and provenance only — never secrets or runtime internals.
 */
export interface HookContext {
  readonly siteId?: string;
  readonly requestId?: string;
  readonly source?: HookSource;
  readonly actor?: HookActor;
}

/** A gate payload: the event plus the right to cancel the operation. */
export type Cancellable<T> = T & {
  /**
   * Abort the pending operation. The reason is surfaced to the end user,
   * so write it for a human.
   */
  cancel(reason: string): void;
};

export type Unsubscribe = () => void;

export interface HookRegisterOptions {
  /** Lower runs earlier. Default 100. */
  priority?: number;
  /** Auto-dispose after the first dispatch. */
  once?: boolean;
  /** Stable label shown in hook diagnostics. */
  id?: string;
}

// ─── Payload shapes ────────────────────────────────────────────────────────

export interface AppEvent {
  readonly version: string;
}

export interface ContentRef {
  readonly contentId: string;
  readonly siteId: string;
}

export interface ContentDraft {
  readonly siteId: string;
  readonly type?: string;
  readonly title: string;
  readonly slug?: string;
  readonly excerpt?: string | null;
  readonly fields?: Record<string, unknown>;
}

export interface ContentCreateGateEvent {
  readonly input: ContentDraft;
}

export interface MediaRef {
  readonly siteId: string;
  readonly mediaId: string;
}

export interface MediaUploadGateEvent {
  readonly siteId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface MediaUploadedEvent extends MediaRef {
  readonly url: string;
}

export interface UserEvent {
  readonly userId: string;
}

export interface AuthEvent {
  readonly userId: string;
  readonly email: string;
}

export interface AuthFailureEvent {
  readonly email: string;
  readonly reason: string;
}

export interface PluginEvent {
  readonly pluginId: string;
  readonly version: string;
  readonly siteId?: string;
}

export interface ThemeEvent {
  readonly themeId: string;
  readonly version: string;
  readonly siteId?: string;
}

export interface RequestStartEvent {
  readonly method: string;
  readonly path: string;
}

export interface RequestEndEvent extends RequestStartEvent {
  readonly statusCode: number;
  readonly durationMs: number;
}

export interface UnderConstructionContext {
  readonly siteId: string;
  readonly siteTitle: string;
  readonly tagline: string;
}

export interface UnderConstructionViewedEvent {
  readonly siteId: string;
}

/** Cache layers that can be selectively revalidated. */
export type CacheObjectType =
  | "pages"
  | "content"
  | "menus"
  | "theme"
  | "cssProviders"
  | "site";

export type CacheRevalidateTrigger =
  | "content"
  | "menus"
  | "theme"
  | "settings"
  | "cssProviders"
  | "manual"
  | "plugin";

export interface CacheRevalidatedEvent {
  readonly trigger: CacheRevalidateTrigger;
  readonly objects: readonly CacheObjectType[];
  readonly siteId?: string;
}

export interface NavigationItem {
  id: string;
  label: string;
  url: string;
  children?: NavigationItem[];
}

// ─── Action map ────────────────────────────────────────────────────────────

/**
 * Every core action, mapped to its payload. Actions observe something that
 * already happened; they cannot cancel it.
 *
 * Plugins publishing their own actions augment this by declaration merging:
 *
 * @example
 * declare module "@justflows/sdk" {
 *   interface ActionEventMap {
 *     "acme.seo.scoreCalculated": { contentId: string; score: number };
 *   }
 * }
 */
export interface ActionEventMap {
  "app.starting": AppEvent;
  "app.started": AppEvent;
  "app.stopping": Record<string, never>;

  "content.created": ContentRef;
  "content.updated": ContentRef;
  "content.deleted": ContentRef;
  "content.published": ContentRef;
  "content.unpublished": ContentRef;

  "media.uploaded": MediaUploadedEvent;
  "media.deleted": MediaRef;

  "user.created": UserEvent;
  "user.updated": UserEvent;
  "user.deleted": UserEvent;
  "auth.login": AuthEvent;
  "auth.logout": AuthEvent;
  "auth.loginFailed": AuthFailureEvent;

  "plugin.installed": PluginEvent;
  "plugin.activated": PluginEvent;
  "plugin.deactivated": PluginEvent;
  "plugin.uninstalled": PluginEvent;
  "theme.installed": ThemeEvent;
  "theme.activated": ThemeEvent;

  "request.before": RequestStartEvent;
  "request.after": RequestEndEvent;

  "site.underConstruction.viewed": UnderConstructionViewedEvent;

  /** Fired after selective cache revalidation completes. */
  "cache.revalidated": CacheRevalidatedEvent;
}

// ─── Gate map ──────────────────────────────────────────────────────────────

/**
 * Every core gate, mapped to its payload. Gates run *before* the operation
 * commits and may cancel it. They fail closed — a handler that throws aborts
 * the operation.
 */
export interface GateEventMap {
  "content.beforeCreate": ContentCreateGateEvent;
  "content.beforeUpdate": ContentRef;
  "content.beforeDelete": ContentRef;
  "content.beforePublish": ContentRef;

  "media.beforeUpload": MediaUploadGateEvent;
  "media.beforeDelete": MediaRef;
}

// ─── Filter map ────────────────────────────────────────────────────────────

/**
 * Every core filter, mapped to `[value, context]`. A filter must return the
 * next value; returning nothing keeps the previous value and logs a warning.
 */
export interface FilterValueMap {
  "content.input": [Record<string, unknown>, { siteId: string }];
  "content.output": [Record<string, unknown>, { siteId: string }];
  "content.render": [string, { siteId: string; contentId: string }];
  "media.metadata": [Record<string, unknown>, MediaRef];
  "navigation.items": [NavigationItem[], { siteId: string; location: string }];
  "http.responseHeaders": [Record<string, string>, { method: string; path: string }];
  "html.head": [string, { siteId: string; path: string; title: string; contentId?: string }];
  "site.underConstruction.render": [string, UnderConstructionContext];
}

/** Filters applied on synchronous render paths — handlers must not be async. */
export const SYNC_FILTERS = [
  "content.render",
  "http.responseHeaders",
  "html.head",
  "site.underConstruction.render",
] as const;

// ─── Name and handler helpers ──────────────────────────────────────────────

/** Known hook names autocomplete; plugin-namespaced names stay assignable. */
type Loose<K extends string> = K | (string & {});

export type ActionName = Loose<keyof ActionEventMap & string>;
export type GateName = Loose<keyof GateEventMap & string>;
export type FilterName = Loose<keyof FilterValueMap & string>;

export type ActionPayload<K> = K extends keyof ActionEventMap ? ActionEventMap[K] : unknown;
export type GatePayload<K> = K extends keyof GateEventMap ? GateEventMap[K] : object;

export type FilterValue<K> = K extends keyof FilterValueMap ? FilterValueMap[K][0] : unknown;
export type FilterContext<K> = K extends keyof FilterValueMap ? FilterValueMap[K][1] : unknown;

export type ActionHandlerFor<K> = (
  event: ActionPayload<K>,
  context: HookContext,
) => void | Promise<void>;

export type GateHandlerFor<K> = (
  event: Cancellable<GatePayload<K>>,
  context: HookContext,
) => void | Promise<void>;

export type FilterHandlerFor<K> = (
  value: FilterValue<K>,
  context: FilterContext<K>,
  hookContext: HookContext,
) => FilterValue<K> | Promise<FilterValue<K>>;

// ─── Hook permissions ──────────────────────────────────────────────────────

/**
 * Hook namespaces that require a manifest permission to listen on. Registering
 * without the permission fails at activation, not silently at runtime.
 */
export const HOOK_PERMISSION_PREFIXES: ReadonlyArray<{
  readonly prefix: string;
  readonly permission: string;
}> = [
  { prefix: "auth.", permission: "auth:hook" },
  { prefix: "user.", permission: "users:read" },
];

/** The permission a hook name requires, or `null` when it is unrestricted. */
export function requiredPermissionForHook(hook: string): string | null {
  for (const rule of HOOK_PERMISSION_PREFIXES) {
    if (hook.startsWith(rule.prefix)) return rule.permission;
  }
  return null;
}

/**
 * A plugin may only emit hooks under its own manifest ID. This keeps the core
 * namespace un-spoofable and makes hook ownership readable from the name.
 */
export function isOwnedHookName(pluginId: string, hook: string): boolean {
  return hook === pluginId || hook.startsWith(`${pluginId}.`);
}
