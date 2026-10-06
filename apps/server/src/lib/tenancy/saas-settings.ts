// SPDX-License-Identifier: MIT

import { validateDatabaseTarget, type DatabaseTarget } from "./choice.js";
import { decryptSecret, encryptSecret } from "../security/secret-box.js";

export interface SignupDatabasePublic {
  host: string;
  port: number;
  database: string;
  username: string;
  passwordSet: boolean;
}

export interface SaasSettings {
  signupEnabled: boolean;
  signupDatabaseMode: "current" | "separate";
  baseDomain: string;
  signupDatabase: SignupDatabasePublic | null;
  /** Days a website stays marked deleted before it is removed. 0 disables the job. */
  purgeAfterDays: number;
}

export interface SignupDatabaseInput {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

interface StoredSignupDatabase {
  host: string;
  port: number;
  database: string;
  username: string;
  passwordCiphertext: string;
}

interface StoredSaasSettings {
  signupEnabled: boolean;
  signupDatabaseMode: "current" | "separate";
  baseDomain: string;
  signupDatabase?: StoredSignupDatabase;
  purgeAfterDays: number;
}

/** 0 keeps a deleted website until an operator removes it. */
export function clampPurgeAfterDays(value: unknown, fallback = 30): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3650) return fallback;
  return parsed;
}

/**
 * `postgres.js` JSON-encodes a value bound next to `::jsonb`. A value that is
 * already `JSON.stringify`'d is stored as a JSON string, and the platform page
 * then finds no `signupEnabled` field. Accept that stored string, and a real
 * object, as the same settings.
 */
export async function platformBaseDomain(): Promise<string> {
  try {
    const { getControlDb } = await import("../database/db.js");
    const db = await getControlDb();
    const rows = await db.query<{ value: unknown }>("SELECT value FROM platform_settings WHERE setting_key = 'saas' LIMIT 1");
    return readSaasSettings(rows[0]?.value)?.baseDomain ?? "";
  } catch {
    return "";
  }
}

export function readSaasSettings(value: unknown): SaasSettings | null {
  const stored = parseStored(value);
  if (!stored) return null;
  return {
    signupEnabled: stored.signupEnabled,
    signupDatabaseMode: stored.signupDatabaseMode,
    baseDomain: stored.baseDomain,
    signupDatabase: stored.signupDatabase
      ? {
          host: stored.signupDatabase.host,
          port: stored.signupDatabase.port,
          database: stored.signupDatabase.database,
          username: stored.signupDatabase.username,
          passwordSet: stored.signupDatabase.passwordCiphertext.length > 0,
        }
      : null,
    purgeAfterDays: clampPurgeAfterDays(stored.purgeAfterDays),
  };
}

/** Connection used by public signup. Null when signup stays on this installation's database. */
export function readSignupDatabaseTarget(value: unknown): DatabaseTarget | null {
  const stored = parseStored(value);
  if (!stored || stored.signupDatabaseMode !== "separate" || !stored.signupDatabase) return null;
  const password = decryptSecret(stored.signupDatabase.passwordCiphertext);
  if (!password) return null;
  return {
    host: stored.signupDatabase.host,
    port: stored.signupDatabase.port,
    database: stored.signupDatabase.database,
    username: stored.signupDatabase.username,
    password,
  };
}

export function buildSaasSettings(
  previous: unknown,
  input: {
    signupEnabled: boolean;
    signupDatabaseMode: "current" | "separate";
    baseDomain: string;
    database?: SignupDatabaseInput | null;
  },
): { ok: true; stored: StoredSaasSettings } | { ok: false; error: string } {
  const prior = parseStored(previous);
  const priorDatabase = prior?.signupDatabase;
  if (input.signupDatabaseMode === "current") {
    return {
      ok: true,
      stored: {
        signupEnabled: input.signupEnabled,
        signupDatabaseMode: "current",
        baseDomain: input.baseDomain,
        ...(priorDatabase ? { signupDatabase: priorDatabase } : {}),
        purgeAfterDays: clampPurgeAfterDays(prior?.purgeAfterDays),
      },
    };
  }

  const database = input.database;
  const host = database?.host?.trim() ?? priorDatabase?.host ?? "";
  const port = database?.port ?? priorDatabase?.port ?? 0;
  const name = database?.database?.trim() ?? priorDatabase?.database ?? "";
  const username = database?.username?.trim() ?? priorDatabase?.username ?? "";
  const password = database?.password ?? "";
  const passwordCiphertext = password
    ? encryptSecret(password)
    : (priorDatabase?.passwordCiphertext ?? "");
  const problem = validateDatabaseTarget({ host, port, database: name, username, password: password || "kept" });
  if (problem) return { ok: false, error: problem };
  if (!passwordCiphertext) return { ok: false, error: "Database password is required." };
  return {
    ok: true,
    stored: {
      signupEnabled: input.signupEnabled,
      signupDatabaseMode: "separate",
      baseDomain: input.baseDomain,
      signupDatabase: { host, port, database: name, username, passwordCiphertext },
      purgeAfterDays: clampPurgeAfterDays(prior?.purgeAfterDays),
    },
  };
}

/** Change only how long a deleted website is kept. Signup settings stay as they are. */
export function withPurgeAfterDays(previous: unknown, days: number): StoredSaasSettings {
  const prior = parseStored(previous);
  return {
    signupEnabled: prior?.signupEnabled === true,
    signupDatabaseMode: prior?.signupDatabaseMode === "separate" ? "separate" : "current",
    baseDomain: prior?.baseDomain ?? "",
    ...(prior?.signupDatabase ? { signupDatabase: prior.signupDatabase } : {}),
    purgeAfterDays: clampPurgeAfterDays(days, 30),
  };
}

function parseStored(value: unknown): StoredSaasSettings | null {
  let raw = value;
  for (let depth = 0; depth < 2 && typeof raw === "string"; depth += 1) {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as {
    signupEnabled?: unknown;
    signupDatabaseMode?: unknown;
    baseDomain?: unknown;
    signupDatabase?: unknown;
    purgeAfterDays?: unknown;
  };
  return {
    signupEnabled: record.signupEnabled === true,
    signupDatabaseMode: record.signupDatabaseMode === "separate" ? "separate" : "current",
    baseDomain: typeof record.baseDomain === "string" ? record.baseDomain : "",
    signupDatabase: parseDatabase(record.signupDatabase),
    purgeAfterDays: clampPurgeAfterDays(record.purgeAfterDays),
  };
}

function parseDatabase(value: unknown): StoredSignupDatabase | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as {
    host?: unknown;
    port?: unknown;
    database?: unknown;
    username?: unknown;
    passwordCiphertext?: unknown;
  };
  const host = typeof record.host === "string" ? record.host : "";
  const database = typeof record.database === "string" ? record.database : "";
  const username = typeof record.username === "string" ? record.username : "";
  const port = typeof record.port === "number" ? record.port : Number(record.port);
  if (!host || !database || !username || !Number.isInteger(port)) return undefined;
  return {
    host,
    port,
    database,
    username,
    passwordCiphertext: typeof record.passwordCiphertext === "string" ? record.passwordCiphertext : "",
  };
}
