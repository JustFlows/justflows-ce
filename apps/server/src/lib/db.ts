/**
 * Lightweight database client for the admin app.
 * Reads connection config from env vars written by the install wizard.
 * Returns a simple run/query interface compatible with both postgres and mysql2.
 */

import fs from "node:fs";
import path from "node:path";
import { envFilePath } from "./jf-root.js";

/** Load .env from repo root (survives Plesk restarts). */
function ensureEnvLoaded() {
  if (process.env.DB_DRIVER) return;
  try {
    const contents = fs.readFileSync(envFilePath(), "utf-8");
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env not yet written — install hasn't run
  }
}

export interface DbClient {
  run(sql: string, params?: (string | number | boolean | null)[]): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: (string | number | boolean | null)[]): Promise<T[]>;
  close(): Promise<void>;
}

let _client: DbClient | null = null;

export async function getDb(): Promise<DbClient> {
  if (_client) return _client;

  ensureEnvLoaded();

  const driver = process.env.DB_DRIVER as "postgres" | "mysql" | "mariadb" | undefined;
  const host = process.env.DB_HOST ?? "localhost";
  const port = process.env.DB_PORT ?? (driver === "postgres" ? "5432" : "3306");
  const database = process.env.DB_NAME ?? "justflows";
  const username = process.env.DB_USER ?? "";
  const password = process.env.DB_PASSWORD ?? "";

  if (!driver) {
    throw new Error("DB_DRIVER not set — run the install wizard first.");
  }

  // Neither driver negotiates TLS on its own, so a managed database (Neon, RDS,
  // PlanetScale) was reached in cleartext — credentials and content included.
  // Default to requiring TLS whenever the host is not local; DB_SSL forces it
  // either way.
  const sslSetting = (process.env.DB_SSL ?? "").trim().toLowerCase();
  const isLocalHost = ["localhost", "127.0.0.1", "::1", ""].includes(host.toLowerCase());
  const useSsl = sslSetting === "" ? !isLocalHost : !["0", "false", "off", "disable"].includes(sslSetting);
  // Set DB_SSL_REJECT_UNAUTHORIZED=0 only for a self-signed server certificate.
  const rejectUnauthorized = !["0", "false", "off"].includes(
    (process.env.DB_SSL_REJECT_UNAUTHORIZED ?? "").trim().toLowerCase(),
  );

  if (driver === "postgres") {
    const { default: postgres } = await import("postgres");
    const url = `postgres://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
    const sql = postgres(url, {
      max: 5,
      ssl: useSsl ? { rejectUnauthorized } : false,
    });

    _client = {
      run: async (query, params = []) => {
        let i = 0;
        const pgQuery = query.replace(/\?/g, () => `$${++i}`);
        await sql.unsafe(pgQuery, params as Parameters<typeof sql.unsafe>[1]);
      },
      query: async <T>(query: string, params: (string | number | boolean | null)[] = []) => {
        let i = 0;
        const pgQuery = query.replace(/\?/g, () => `$${++i}`);
        const rows = await sql.unsafe(pgQuery, params as Parameters<typeof sql.unsafe>[1]);
        return rows as unknown as T[];
      },
      close: () => sql.end(),
    };
  } else {
    const mysql = await import("mysql2/promise");
    const pool = mysql.createPool({
      host,
      port: Number(port),
      user: username,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 5,
      ...(useSsl ? { ssl: { minVersion: "TLSv1.2", rejectUnauthorized } } : {}),
    });

    _client = {
      run: async (query, params = []) => {
        await pool.execute(query, params);
      },
      query: async <T>(query: string, params: (string | number | boolean | null)[] = []) => {
        const [rows] = await pool.execute(query, params);
        return rows as T[];
      },
      close: async () => pool.end(),
    };
  }

  return _client;
}

/** Reset the cached client (call after install completes). */
export function resetDb() {
  _client = null;
}
