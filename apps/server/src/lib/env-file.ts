import fs from "node:fs/promises";
import { envFilePath } from "./jf-root.js";

/**
 * A newline in a value would end the KEY=VALUE line and let whatever follows be
 * parsed as another assignment. Because dotenv keeps the first occurrence of a
 * key, an injected line can also override a value written later in the file —
 * including APP_SECRET. Refuse rather than strip, so the caller learns the
 * value was rejected instead of silently storing a mangled one.
 */
export function assertSafeEnvValue(key: string, value: string): void {
  if (/[\r\n\0]/.test(value)) {
    throw new Error(`Invalid value for ${key}: line breaks and null bytes are not allowed`);
  }
}

/** Parse KEY=VALUE lines from the app .env file (comments and blanks ignored). */
export async function readEnvMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let contents: string;
  try {
    contents = await fs.readFile(envFilePath(), "utf-8");
  } catch {
    return map;
  }

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) map.set(key, value);
  }
  return map;
}

/**
 * Merge updates into .env. Pass `null` as a value to remove a key.
 * Preserves unrelated lines and comments.
 */
export async function updateEnvKeys(updates: Record<string, string | null>): Promise<void> {
  for (const [key, value] of Object.entries(updates)) {
    if (value !== null) assertSafeEnvValue(key, value);
  }

  let lines: string[];
  try {
    lines = (await fs.readFile(envFilePath(), "utf-8")).split("\n");
  } catch {
    lines = [];
  }

  const touched = new Set<string>();
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      out.push(line);
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      out.push(line);
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (!(key in updates)) {
      out.push(line);
      continue;
    }
    touched.add(key);
    const value = updates[key];
    if (value !== null) out.push(`${key}=${value}`);
  }

  const additions = Object.entries(updates).filter(
    ([key, value]) => !touched.has(key) && value !== null,
  );

  if (additions.length > 0) {
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
    if (!out.some((l) => l.trim().startsWith("# Cache"))) {
      out.push("# Cache (jf-cache)");
    }
    for (const [key, value] of additions) {
      out.push(`${key}=${value!}`);
    }
  }

  const body = out.join("\n").replace(/\n+$/, "") + "\n";
  await fs.writeFile(envFilePath(), body, { encoding: "utf-8", mode: 0o600 });
  // `mode` only applies when writeFile creates the file. An .env that already
  // existed keeps whatever permissions it had, so set them explicitly.
  await fs.chmod(envFilePath(), 0o600).catch(() => undefined);
}

/** Apply key/value pairs to the running process (until restart replaces them). */
export function applyEnvToProcess(vars: Record<string, string | null>): void {
  for (const [key, value] of Object.entries(vars)) {
    if (value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
