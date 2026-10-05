// SPDX-License-Identifier: MIT

import type { DatabaseChoice, DatabaseMode, UserMode } from "./context.js";

export interface DatabaseTarget {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

export function effectiveDatabaseMode(tenantMode: DatabaseMode, choice: DatabaseChoice): DatabaseMode {
  if (choice === "inherit") return tenantMode;
  return choice;
}

export function quoteDatabaseIdent(name: string, driver: "postgres" | "mysql" | "mariadb"): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) {
    throw new Error("Invalid database name");
  }
  return driver === "postgres" ? `"${name}"` : `\`${name}\``;
}

export function validateDatabaseTarget(target: Partial<DatabaseTarget> | null | undefined): string | null {
  if (!target) return "A separate database needs a host, port, database name, and username.";
  const host = target.host?.trim() ?? "";
  const database = target.database?.trim() ?? "";
  const username = target.username?.trim() ?? "";
  if (!host || /[\r\n\s]/.test(host) || host.length > 255) return "Database host is not valid.";
  if (!Number.isInteger(target.port) || (target.port ?? 0) < 1 || (target.port ?? 0) > 65535) {
    return "Database port is not valid.";
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(database)) {
    return "Database name may only use letters, numbers, and underscores.";
  }
  if (!username || /[\r\n]/.test(username) || username.length > 255) return "Database username is not valid.";
  if ((target.password ?? "").length > 1024 || /[\r\n]/.test(target.password ?? "")) {
    return "Database password is not valid.";
  }
  return null;
}

/**
 * Shared users live in one database. A site can leave that database only when
 * the workspace keeps a separate user directory per site.
 */
export function validateDatabaseChoice(input: {
  userMode: UserMode;
  tenantMode: DatabaseMode;
  siteChoice: DatabaseChoice;
  target?: Partial<DatabaseTarget> | null;
}): { ok: true; mode: DatabaseMode } | { ok: false; error: string } {
  const mode = effectiveDatabaseMode(input.tenantMode, input.siteChoice);
  if (input.userMode === "shared" && input.siteChoice !== "inherit") {
    return {
      ok: false,
      error:
        "Shared users keep every site on the workspace database. Leave this site on that database, or switch the workspace to isolated users before giving a site its own database.",
    };
  }
  if (mode === "separate" && input.siteChoice === "separate") {
    const problem = validateDatabaseTarget(input.target);
    if (problem) return { ok: false, error: problem };
  }
  return { ok: true, mode };
}

export function sanitizeDatabaseError(err: unknown, password: string): string {
  const raw = err instanceof Error ? err.message : "database connection failed";
  const redacted = password ? raw.split(password).join("[redacted]") : raw;
  return redacted.replace(/[\r\n]/g, " ").slice(0, 300);
}
