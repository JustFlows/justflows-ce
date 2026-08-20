// SPDX-License-Identifier: MIT

// Configuration
export { loadConfig } from "./config/loader.js";
export { parseEnvBool } from "./config/env-bool.js";
export {
  AppConfigSchema,
  DatabaseConfigSchema,
  StorageConfigSchema,
  CacheConfigSchema,
} from "./config/schema.js";
export type { AppConfig, DatabaseConfig, StorageConfig, CacheConfig } from "./config/schema.js";

// Logging
export { createLogger, ConsoleLogger } from "./logging/logger.js";
export type { Logger, LogLevel, LogEntry } from "./logging/logger.js";

// Hooks
export { HooksRegistry } from "./hooks/registry.js";
export { HookAbortError, isHookAbortError } from "./hooks/errors.js";
export type {
  ActionHandler,
  GateHandler,
  FilterHandler,
  Cancellable,
  HookContext,
  HookActor,
  HookSource,
  HookKind,
  HookInspection,
  HookRegisterOptions,
  HooksRegistryOptions,
  Unsubscribe,
} from "./hooks/registry.js";

// Settings
export { SettingsStore } from "./settings/store.js";
export type { Setting } from "./settings/store.js";

// Health
export { HealthMonitor } from "./health/check.js";
export type { HealthStatus, HealthCheckResult, HealthReport, HealthChecker } from "./health/check.js";

// Lifecycle
export { App } from "./lifecycle/app.js";
export type { AppState, AppContext } from "./lifecycle/app.js";
