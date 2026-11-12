// SPDX-License-Identifier: MIT
/**
 * Database connection a hosting integration created before the first-run
 * wizard (for example the Plesk or cPanel installer).
 *
 * The host marks it with `DB_PROVISIONED=true` in `.env`, next to complete
 * `DB_*` settings. The marker has to be explicit: a copied `.env.example`
 * also has `DB_*` lines, with placeholder values that must never be treated
 * as a working connection.
 *
 * The password is only ever read on the server. The wizard learns that a
 * database is provided and which driver it uses, nothing more.
 */
import { readEnvMap } from "../settings/env-file.js";

export type ProvisionedDriver = "postgres" | "mysql" | "mariadb";

export interface ProvisionedDatabase {
  driver: ProvisionedDriver;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

const DRIVERS: readonly ProvisionedDriver[] = ["postgres", "mysql", "mariadb"];
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

/** Removes one pair of matching surrounding quotes, as dotenv does. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value.endsWith(first)) {
      const inner = value.slice(1, -1);
      return first === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : inner;
    }
  }
  return value;
}

/**
 * Returns the provisioned connection, or null when the marker is missing or
 * any setting is absent or invalid.
 */
export function parseProvisionedDatabase(env: ReadonlyMap<string, string>): ProvisionedDatabase | null {
  const get = (key: string): string => unquote((env.get(key) ?? "").trim());

  if (!TRUE_VALUES.has(get("DB_PROVISIONED").toLowerCase())) return null;

  const driver = get("DB_DRIVER").toLowerCase() as ProvisionedDriver;
  const host = get("DB_HOST");
  const port = Number(get("DB_PORT"));
  const database = get("DB_NAME");
  const username = get("DB_USER");
  if (!env.has("DB_PASSWORD")) return null;
  const password = get("DB_PASSWORD");

  if (
    !DRIVERS.includes(driver) ||
    !host ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !database ||
    !username ||
    [host, database, username, password].some((v) => /[\r\n\0]/.test(v))
  ) {
    return null;
  }

  return { driver, host, port, database, username, password };
}

export async function readProvisionedDatabase(): Promise<ProvisionedDatabase | null> {
  return parseProvisionedDatabase(await readEnvMap());
}
