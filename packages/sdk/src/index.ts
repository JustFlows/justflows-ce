// SPDX-License-Identifier: MIT

// Hooks — typed action/gate/filter contracts
export {
  SYNC_FILTERS,
  HOOK_PERMISSION_PREFIXES,
  requiredPermissionForHook,
  isOwnedHookName,
} from "./hooks.js";
export type {
  HookContext,
  HookActor,
  HookSource,
  HookRegisterOptions,
  Cancellable,
  Unsubscribe,
  ActionEventMap,
  GateEventMap,
  FilterValueMap,
  ActionName,
  GateName,
  FilterName,
  ActionPayload,
  GatePayload,
  FilterValue,
  FilterContext,
  ActionHandlerFor,
  GateHandlerFor,
  FilterHandlerFor,
  AppEvent,
  ContentRef,
  ContentDraft,
  ContentCreateGateEvent,
  MediaRef,
  MediaUploadGateEvent,
  MediaUploadedEvent,
  UserEvent,
  AuthEvent,
  AuthFailureEvent,
  PluginEvent,
  ThemeEvent,
  RequestStartEvent,
  RequestEndEvent,
  NavigationItem,
  CacheObjectType,
  CacheRevalidateTrigger,
  CacheRevalidatedEvent,
} from "./hooks.js";

// Plugin — manifest, permissions, context
export {
  PluginManifestSchema,
  PluginPermissionSchema,
  SENSITIVE_PERMISSIONS,
  AdminMenuItemSchema,
  ADMIN_MENU_DOMAINS,
} from "./plugin.js";
export type {
  PluginManifest,
  PluginAdminMenuItem,
  AdminMenuDomain,
  PluginPermission,
  PluginContext,
  PluginModule,
  PluginCacheApi,
  PluginHttpApi,
  PluginHttpRequest,
  PluginHttpResponse,
  PluginHttpHandler,
  PluginDataApi,
  PluginDataRecord,
  PluginBlocksApi,
  PluginBlockDefinition,
} from "./plugin.js";

// Capabilities — user capability system
export {
  USER_CAPABILITIES,
  ROLE_CAPABILITIES,
  roleHasCapability,
} from "./capabilities.js";
export type { UserCapability } from "./capabilities.js";

// Licensing — extension license validation (Marketplace: GPL-compatible)
export {
  isGplCompatibleLicense,
  gplLicenseValidationMessage,
} from "./license.js";
