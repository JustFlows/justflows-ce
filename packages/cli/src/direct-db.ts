// SPDX-License-Identifier: MIT

/**
 * A minimal direct database connection for CLI commands that must run when the
 * Justflows server itself is not reachable or cannot authenticate the caller —
 * the locked-out-administrator case that `justflows user reset-password` exists
 * for.
 *
 * Every other CLI command talks to the running server over HTTP (`../api.js`);
 * this is the deliberate exception. It reads the same `.env` the install wizard
 * writes and speaks the same `?`-placeholder dialect as the server's own query
 * layer, but has no pool, transactions, or migration machinery — just `query`
 * and `run`.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type DbDriver = "postgres" | "mysql" | "mariadb";

export interface DirectDb {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<void>;
  close(): Promise<void>;
}

/** Locate the install root: `JF_ROOT`, or the nearest ancestor with server.js + migrations/. */
export function findRoot(): string {
  if (process.env["JF_ROOT"]) return process.env["JF_ROOT"];
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, "server.js")) && existsSync(path.join(dir, "migrations"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** Populate process.env from the install root's `.env`, without overwriting real env vars. */
export function loadEnv(root = findRoot()): void {
  if (process.env["DB_DRIVER"]) return;
  const file = path.join(root, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

/** Connect using the DB_* variables the installer writes. Mirrors the server's TLS defaults. */
export async function connectDirect(): Promise<{ db: DirectDb; driver: DbDriver }> {
  loadEnv();

  const driver = process.env["DB_DRIVER"] as DbDriver | undefined;
  if (!driver) {
    throw new Error("DB_DRIVER is not set — run this from the Justflows install directory.");
  }

  const host = process.env["DB_HOST"] ?? "localhost";
  const port = process.env["DB_PORT"] ?? (driver === "postgres" ? "5432" : "3306");
  const database = process.env["DB_NAME"] ?? "justflows";
  const user = process.env["DB_USER"] ?? "";
  const password = process.env["DB_PASSWORD"] ?? "";

  const sslSetting = (process.env["DB_SSL"] ?? "").trim().toLowerCase();
  const isLocal = ["localhost", "127.0.0.1", "::1", ""].includes(host.toLowerCase());
  const useSsl = sslSetting === "" ? !isLocal : !["0", "false", "off", "disable"].includes(sslSetting);
  const rejectUnauthorized = !["0", "false", "off"].includes(
    (process.env["DB_SSL_REJECT_UNAUTHORIZED"] ?? "").trim().toLowerCase(),
  );

  if (driver === "postgres") {
    const { default: postgres } = await import("postgres");
    const url = `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
    const sql = postgres(url, { max: 1, ssl: useSsl ? { rejectUnauthorized } : false });
    const toPg = (q: string): string => {
      let i = 0;
      return q.replace(/\?/g, () => `$${(i += 1)}`);
    };
    return {
      driver,
      db: {
        query: async <T>(q: string, params: unknown[] = []) =>
          (await sql.unsafe(toPg(q), params as never[])) as unknown as T[],
        run: async (q: string, params: unknown[] = []) => {
          await sql.unsafe(toPg(q), params as never[]);
        },
        close: () => sql.end(),
      },
    };
  }

  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection({
    host,
    port: Number(port),
    user,
    password,
    database,
    ...(useSsl ? { ssl: { minVersion: "TLSv1.2", rejectUnauthorized } } : {}),
  });
  return {
    driver,
    db: {
      query: async <T>(q: string, params: unknown[] = []) => {
        const [rows] = await conn.execute(q, params as never[]);
        return rows as T[];
      },
      run: async (q: string, params: unknown[] = []) => {
        await conn.execute(q, params as never[]);
      },
      close: () => conn.end(),
    },
  };
}
