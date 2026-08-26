import fs from "node:fs/promises";
import path from "node:path";
import { migrationsDir } from "./jf-root.js";

export const MIGRATION_ORDER = [
  "0001_initial",
  "0002_multilingual",
  "0003_css_providers",
  "0004_plugin_data",
  "0005_content_types",
  "0006_session_revocation",
  "0007_totp",
  "0008_audit_log",
  "0009_audit_log_compat",
] as const;

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
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  // MySQL/MariaDB 1091: DROP INDEX / DROP COLUMN when the object is already gone.
  if (code === "ER_CANT_DROP_FIELD_OR_KEY") return true;
  if (msg.includes("already exists")) return true;
  if (msg.includes("duplicate column")) return true;
  if (msg.includes("duplicate key name")) return true;
  if (msg.includes("duplicate entry")) return true;
  if (msg.includes("check that it exists")) return true;
  if (msg.includes("can't drop index")) return true;
  if (msg.includes("can't drop foreign key")) return true;
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

function withoutIfExists(sql: string): string {
  return sql.replace(/\s+IF\s+EXISTS\b/gi, "");
}

export async function runMigrationStatements(
  sql: SqlRunner,
  ddl: string,
  driver: DbDriver,
): Promise<void> {
  for (const stmt of splitSqlStatements(ddl, driver)) {
    try {
      await sql.run(stmt);
    } catch (err: unknown) {
      if (isIgnorableMigrationError(err)) continue;
      // MySQL 8 rejects DROP INDEX IF EXISTS; retry the plain DROP, then ignore 1091.
      if (driver !== "postgres" && /\bif\s+exists\b/i.test(stmt)) {
        try {
          await sql.run(withoutIfExists(stmt));
          continue;
        } catch (retryErr: unknown) {
          if (isIgnorableMigrationError(retryErr)) continue;
          throw retryErr;
        }
      }
      throw err;
    }
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

/** Apply shipped schema updates for an already-installed site (zip/core update). */
export async function applyPendingMigrations(): Promise<void> {
  const { getDb } = await import("./db.js");
  const db = await getDb();
  const driver = process.env.DB_DRIVER as DbDriver | undefined;
  if (!driver) return;
  await runAllMigrations(db, driver);
}
