import fs from "node:fs/promises";
import path from "node:path";
import { migrationsDir } from "./jf-root.js";

export const MIGRATION_ORDER = ["0001_initial", "0002_multilingual", "0003_css_providers", "0004_plugin_data"] as const;

export type DbDriver = "postgres" | "mysql" | "mariadb";

interface SqlRunner {
  run(sql: string, params?: (string | number | boolean | null)[]): Promise<void>;
}

/** Split SQL file into executable statements (handles comments, BEGIN/COMMIT). */
export function splitSqlStatements(ddl: string, driver: DbDriver): string[] {
  const withoutLineComments = ddl
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  return withoutLineComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => {
      if (!s) return false;
      if (driver !== "postgres" && /^BEGIN$/i.test(s)) return false;
      if (driver !== "postgres" && /^COMMIT$/i.test(s)) return false;
      return true;
    });
}

/** Idempotent migration errors we can safely ignore on re-run. */
export function isIgnorableMigrationError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  if (msg.includes("already exists")) return true;
  if (msg.includes("duplicate column")) return true;
  if (msg.includes("duplicate key name")) return true;
  if (msg.includes("duplicate entry")) return true;
  return false;
}

export async function readMigrationDdl(name: string, driver: DbDriver): Promise<string | null> {
  const dir = migrationsDir();
  const driverFile =
    driver === "postgres"
      ? path.join(dir, `${name}.sql`)
      : path.join(dir, `${name}.${driver}.sql`);

  try {
    return await fs.readFile(driverFile, "utf-8");
  } catch {
    try {
      return await fs.readFile(path.join(dir, `${name}.sql`), "utf-8");
    } catch {
      return null;
    }
  }
}

export async function runMigrationStatements(
  sql: SqlRunner,
  ddl: string,
  driver: DbDriver,
): Promise<void> {
  for (const stmt of splitSqlStatements(ddl, driver)) {
    await sql.run(stmt).catch((e: unknown) => {
      if (isIgnorableMigrationError(e)) return;
      throw e;
    });
  }
}

export async function runAllMigrations(
  sql: SqlRunner,
  driver: DbDriver,
  names: readonly string[] = MIGRATION_ORDER,
): Promise<void> {
  for (const name of names) {
    const ddl = await readMigrationDdl(name, driver);
    if (!ddl) continue;
    await runMigrationStatements(sql, ddl, driver);
  }
}
