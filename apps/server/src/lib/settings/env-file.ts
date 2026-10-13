import fs from "node:fs/promises";
import { envFilePath } from "../runtime/jf-root.js";

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

function lineKey(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  return eq === -1 ? null : trimmed.slice(0, eq).trim() || null;
}

/** `# KEY=example` placeholders, as the install template writes for optional keys. */
function commentedKey(line: string): string | null {
  const m = /^#\s*([A-Z][A-Z0-9_]*)=/.exec(line.trim());
  return m ? m[1]! : null;
}

/** Leading `_` segments two keys share: JF_IMAGE_WIDTHS / JF_IMAGE_THUMB → 2. */
function sharedSegments(a: string, b: string): number {
  const x = a.split("_");
  const y = b.split("_");
  let n = 0;
  while (n < x.length && n < y.length && x[n] === y[n]) n += 1;
  return n;
}

/**
 * Merge updates into the lines of an .env file. `null` removes a key.
 * Unrelated lines and comments are kept. A key not yet in the file goes
 * where it belongs instead of at the bottom: in place of its commented
 * placeholder, else right after the key before it in `updates` (the
 * caller's order), else after the last key of its prefix group
 * (JF_IMAGE_*, CACHE_*), else at the end.
 */
export function mergeEnvLines(lines: string[], updates: Record<string, string | null>): string[] {
  const out: string[] = [];
  const present = new Set<string>();
  for (const line of lines) {
    const key = lineKey(line);
    if (key === null || !(key in updates)) {
      out.push(line);
      continue;
    }
    present.add(key);
    const value = updates[key];
    if (value !== null) out.push(`${key}=${value}`);
  }

  const order = Object.keys(updates);
  const indexOfKey = (key: string): number => out.findIndex((line) => lineKey(line) === key);
  for (const [position, key] of order.entries()) {
    const value = updates[key];
    if (present.has(key) || value === null) continue;
    const entry = `${key}=${value}`;
    present.add(key);

    const placeholder = out.findIndex((line) => commentedKey(line) === key);
    if (placeholder !== -1) {
      out[placeholder] = entry;
      continue;
    }

    let at = -1;
    for (let i = position - 1; i >= 0 && at === -1; i -= 1) {
      const found = indexOfKey(order[i]!);
      if (found !== -1) at = found + 1;
    }
    if (at === -1) {
      // The group prefix: CACHE for CACHE_TTL_SECONDS; under the shared JF_ /
      // JUSTFLOWS_ namespaces one more segment (JF_IMAGE for JF_IMAGE_AVIF_EFFORT).
      const needed = /^(JF|JUSTFLOWS)_/.test(key) ? 2 : 1;
      let best = 0;
      out.forEach((line, i) => {
        const other = lineKey(line) ?? commentedKey(line);
        if (!other) return;
        const shared = sharedSegments(key, other);
        if (shared >= needed && shared >= best) {
          best = shared;
          at = i + 1;
        }
      });
    }
    if (at === -1) {
      while (out.length > 0 && out[out.length - 1]!.trim() === "") out.pop();
      if (out.length > 0) out.push("");
      at = out.length;
    }
    out.splice(at, 0, entry);
  }
  return out;
}

/** Merge updates into .env (see {@link mergeEnvLines}). Pass `null` as a value to remove a key. */
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

  const body = mergeEnvLines(lines, updates).join("\n").replace(/\n+$/, "") + "\n";
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
