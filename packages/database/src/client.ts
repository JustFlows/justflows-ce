import postgres from "postgres";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzleMySql } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema/index.js";
import type { DatabaseConfig } from "@justflows/core";

export interface DatabaseClient {
  dialect: DatabaseConfig["driver"];
  db: unknown;
  close(): Promise<void>;
  ping(): Promise<void>;
}

export function createDatabase(config: DatabaseConfig): DatabaseClient {
  if (config.driver === "postgres") {
    const sql = postgres(config.url, {
      max: config.poolMax,
      idle_timeout: 30,
      connect_timeout: 10,
      ssl: config.ssl ? "require" : false,
    });

    const db = drizzlePg(sql, { schema });

    async function close(): Promise<void> {
      await sql.end();
    }

    async function ping(): Promise<void> {
      await sql`SELECT 1`;
    }

    return { dialect: "postgres", db, close, ping };
  }

  // mysql and mariadb both use the mysql2 protocol/driver.
  const parsed = parseSqlUrl(config.url);
  const pool = mysql.createPool({
    host: parsed.host,
    port: parsed.port,
    user: parsed.user,
    password: parsed.password,
    database: parsed.database,
    connectionLimit: config.poolMax,
    waitForConnections: true,
    ssl: config.ssl ? {} : undefined,
  });

  // Note: Our current schema package is PostgreSQL-specific.
  // We intentionally omit schema wiring for mysql/mariadb in Phase 1.
  const db = drizzleMySql(pool);

  async function close(): Promise<void> {
    await pool.end();
  }

  async function ping(): Promise<void> {
    const conn = await pool.getConnection();
    try {
      await conn.query("SELECT 1");
    } finally {
      conn.release();
    }
  }

  return { dialect: config.driver, db, close, ping };
}

function parseSqlUrl(urlString: string): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  const url = new URL(urlString);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
  };
}
