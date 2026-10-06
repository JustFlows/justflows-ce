const CONTAINER_METHODS = new Set([
  "container",
  "kubernetes",
  "heroku",
  "fly",
  "render",
  "railway",
  "nomad",
  "ecs",
  "cloudrun",
]);

/** Unit name safe to show in the admin. Falls back to the usual service name. */
export function serviceUnitName(target?: string): string {
  if (!target?.endsWith(".service")) return "justflows";
  const name = target.slice(0, -".service".length);
  if (!name || name.includes("/") || name.includes(" ") || name.includes("\\")) return "justflows";
  return name;
}

function variant(method?: string): "" | "Passenger" | "Systemd" | "Container" {
  if (method === "passenger") return "Passenger";
  if (method === "systemd") return "Systemd";
  if (method && CONTAINER_METHODS.has(method)) return "Container";
  return "";
}

/** Catalog key for the manual-restart banner or log line. */
export function manualRestartKey(
  scope: "tools" | "updates",
  kind: "body" | "log",
  method?: string,
): string {
  const suffix = variant(method);
  if (scope === "updates" && kind === "log") return `updates.log.manualRestartNeeded${suffix}`;
  if (scope === "updates") return `updates.manualRestartBody${suffix}`;
  if (kind === "log") return `tools.manualRestartNeededLog${suffix}`;
  return `tools.manualRestartBody${suffix}`;
}
