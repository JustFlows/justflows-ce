/** Parse common env boolean strings (0/false/off/no vs 1/true/on/yes). */
export function parseEnvBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  const lower = value.toLowerCase();
  if (["0", "false", "off", "no"].includes(lower)) return false;
  if (["1", "true", "on", "yes"].includes(lower)) return true;
  return defaultValue;
}
