// SPDX-License-Identifier: MIT
import { DatabaseSync } from "node:sqlite";

/**
 * An in-memory SQLite database shaped like the `DbClient` from
 * `lib/database/db.ts`, with just the tables the AI stores touch. Lets the
 * OAuth and credential stores run their real SQL in unit tests; the three
 * production engines are covered by the opt-in migration integration test.
 */

const SCHEMA = `
CREATE TABLE users (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, role TEXT NOT NULL, email TEXT, display_name TEXT);
CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, client_id TEXT NOT NULL UNIQUE, client_secret_hash TEXT,
  client_name TEXT NOT NULL, client_uri TEXT, redirect_uris_json TEXT NOT NULL,
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_used_at TEXT
);
CREATE TABLE oauth_grants (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, capabilities_json TEXT NOT NULL DEFAULT '[]', mcp_user_tools INTEGER NOT NULL DEFAULT 0,
  resource TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_used_at TEXT, revoked_at TEXT
);
CREATE TABLE oauth_codes (
  code_hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, code_challenge TEXT NOT NULL,
  resource TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE oauth_tokens (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, grant_id TEXT NOT NULL, resource TEXT NOT NULL,
  expires_at TEXT NOT NULL, used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE ai_provider_credentials (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, user_id TEXT, scope_key TEXT NOT NULL, provider TEXT NOT NULL, label TEXT,
  api_key_enc TEXT NOT NULL, key_last4 TEXT NOT NULL, base_url TEXT, organization TEXT, project TEXT,
  models_json TEXT NOT NULL DEFAULT '[]', default_model TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (site_id, scope_key, provider)
);
CREATE TABLE ai_usage_daily (
  site_id TEXT NOT NULL, user_id TEXT NOT NULL, usage_day TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, usage_day)
);
`;

type Param = string | number | boolean | null;

function bind(params: Param[] = []): (string | number | null)[] {
  return params.map((value) => (typeof value === "boolean" ? (value ? 1 : 0) : value));
}

export interface SqliteDb {
  sqlite: DatabaseSync;
  query<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T[]>;
  run(sql: string, params?: Param[]): Promise<void>;
  execute(sql: string, params?: Param[]): Promise<number>;
  transaction<T>(fn: (tx: SqliteDb) => Promise<T>): Promise<T>;
}

export function createSqliteDb(): SqliteDb {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(SCHEMA);
  const client: SqliteDb = {
    sqlite,
    async query<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T[]> {
      return sqlite.prepare(sql).all(...bind(params)) as T[];
    },
    async run(sql: string, params?: Param[]): Promise<void> {
      sqlite.prepare(sql).run(...bind(params));
    },
    async execute(sql: string, params?: Param[]): Promise<number> {
      return Number(sqlite.prepare(sql).run(...bind(params)).changes);
    },
    async transaction<T>(fn: (tx: SqliteDb) => Promise<T>): Promise<T> {
      return fn(client);
    },
  };
  return client;
}
