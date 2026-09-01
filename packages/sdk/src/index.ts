// SPDX-License-Identifier: MIT

export { SDK_VERSION, SDK_API_VERSION } from "./version.js";
export { ExtensionEnginesSchema } from "./compatibility.js";
export type { ExtensionEngines } from "./compatibility.js";

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
  ContentDeletedRef,
  ContentRenderContext,
  PublicComment,
  CommentsBlockRenderContext,
  ContentDraft,
  ContentCreateGateEvent,
  ContentRevisionSnapshot,
  ContentRevisionRef,
  ContentUpdateGateEvent,
  ContentConflict,
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
  AdminNavItem,
  HeaderConfig,
  HeaderBuildContext,
  HeaderTemplate,
  HeaderResolveContext,
  OpenApiDocument,
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
  PLUGIN_DELETE_DATA_SETTING,
  PLUGIN_DELETE_CONTENT_SETTING,
  pluginShouldDeleteData,
  pluginShouldDeleteContent,
} from "./plugin.js";
export {
  RegistryListingSchema,
  RegistryPriceSchema,
  isRegistryListingPaid,
  isRegistryListingVisible,
  isRegistryListingComingSoon,
} from "./registry.js";
export type { RegistryListing, RegistryPrice } from "./registry.js";
export type {
  PluginManifest,
  PluginAdminMenuItem,
  AdminMenuDomain,
  PluginPermission,
  PluginContext,
  PluginModule,
  PluginCacheApi,
  PluginHttpApi,
  PluginHttpMethod,
  PluginHttpRequest,
  PluginHttpSession,
  PluginHttpResponse,
  PluginHttpHandler,
  PluginJobsApi,
  PluginJobContext,
  PluginJobDefinition,
  PluginJobResult,
  PluginDataApi,
  PluginDataRecord,
  PluginDatabasesApi,
  PluginDatabaseDriver,
  PluginDatabaseTarget,
  PluginDatabaseProbeResult,
  PluginSchemaTable,
  PluginSchemaColumn,
  PluginSchemaIndex,
  PluginSchemaApplyResult,
  PluginColumnType,
  PluginSecretsApi,
  PluginBlocksApi,
  PluginBlockDefinition,
  PluginContentApi,
  PluginContentField,
  PluginContentEnsureResult,
  PluginContentDeleteTypeResult,
  JustflowsRuntimeVersions,
} from "./plugin.js";

// Capabilities — user capability system
export { USER_CAPABILITIES, ROLE_CAPABILITIES, roleHasCapability } from "./capabilities.js";
export type { UserCapability } from "./capabilities.js";

// Licensing — extension license validation (Marketplace: GPL-compatible)
export { isGplCompatibleLicense, gplLicenseValidationMessage } from "./license.js";
