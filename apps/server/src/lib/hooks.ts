import { createLogger, HooksRegistry, type LogLevel } from "@justflows/core";

let registry: HooksRegistry | null = null;

function logLevel(): LogLevel {
  const level = process.env.LOG_LEVEL;
  if (level === "debug" || level === "info" || level === "warn" || level === "error") {
    return level;
  }
  return "info";
}

/** Process-wide hook registry. Plugins register handlers here via PluginLoader. */
export function getHooks(): HooksRegistry {
  if (!registry) {
    registry = new HooksRegistry({
      logger: createLogger(logLevel()).child({ component: "hooks" }),
    });
  }
  return registry;
}
