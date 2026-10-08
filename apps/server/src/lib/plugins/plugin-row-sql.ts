// SPDX-License-Identifier: MIT

import type {
  PluginDatabaseDriver,
  PluginRowFindOptions,
  PluginRowIncrementOptions,
  PluginRowMatch,
  PluginRowValue,
} from "@justflows/sdk";

/** SQL for plugin row operations. Every statement is scoped to one site. */

const IDENT = /^[a-z][a-z0-9_]{0,47}$/;
const MAX_LIMIT = 500;

export type RowStatement = { sql: string; params: PluginRowValue[] };

export function quoteIdent(value: string, driver: PluginDatabaseDriver): string {
  if (!IDENT.test(value)) {
    throw new Error(`Invalid identifier "${value}"`);
  }
  return driver === "postgres" ? `"${value}"` : `\`${value}\``;
}

function entries(values: PluginRowMatch | undefined): [string, PluginRowValue][] {
  return Object.entries(values ?? {}).filter(([, value]) => value !== undefined);
}

/** `site_id = ? AND col = ? AND other IS NULL`. Throws on an invalid column. */
export function whereClause(
  siteId: string,
  where: PluginRowMatch | undefined,
  driver: PluginDatabaseDriver,
): RowStatement {
  const parts = [`${quoteIdent("site_id", driver)} = ?`];
  const params: PluginRowValue[] = [siteId];
  for (const [col, value] of entries(where)) {
    if (col === "site_id") continue;
    if (value === null) {
      parts.push(`${quoteIdent(col, driver)} IS NULL`);
    } else {
      parts.push(`${quoteIdent(col, driver)} = ?`);
      params.push(value);
    }
  }
  return { sql: parts.join(" AND "), params };
}

function requireFilter(where: PluginRowMatch | undefined, action: string): void {
  if (entries(where).every(([col]) => col === "site_id")) {
    throw new Error(`Cannot ${action} rows without a column match`);
  }
}

export function selectRows(
  table: string,
  siteId: string,
  where: PluginRowMatch | undefined,
  options: PluginRowFindOptions | undefined,
  driver: PluginDatabaseDriver,
): RowStatement {
  const filter = whereClause(siteId, where, driver);
  const limit = Math.min(Math.max(1, Math.trunc(options?.limit ?? 100) || 100), MAX_LIMIT);
  const order = (options?.orderBy ?? []).map(
    (item) => `${quoteIdent(item.column, driver)} ${item.direction === "desc" ? "DESC" : "ASC"}`,
  );
  return {
    sql:
      `SELECT * FROM ${quoteIdent(table, driver)} WHERE ${filter.sql}` +
      (order.length ? ` ORDER BY ${order.join(", ")}` : "") +
      ` LIMIT ${limit}` +
      (options?.lock ? " FOR UPDATE" : ""),
    params: filter.params,
  };
}

/**
 * Insert one row. PostgreSQL skips a unique conflict with `ON CONFLICT DO
 * NOTHING`; MySQL and MariaDB report it as a duplicate-key error, which the
 * caller treats as "not inserted".
 */
export function insertRow(
  table: string,
  siteId: string,
  row: PluginRowMatch,
  driver: PluginDatabaseDriver,
): RowStatement {
  const values = entries({ ...row, site_id: siteId });
  const cols = values.map(([col]) => quoteIdent(col, driver));
  return {
    sql:
      `INSERT INTO ${quoteIdent(table, driver)} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})` +
      (driver === "postgres" ? " ON CONFLICT DO NOTHING" : ""),
    params: values.map(([, value]) => value),
  };
}

export function updateRows(
  table: string,
  siteId: string,
  where: PluginRowMatch,
  values: PluginRowMatch,
  driver: PluginDatabaseDriver,
): RowStatement | null {
  requireFilter(where, "update");
  const sets = entries(values).filter(([col]) => col !== "site_id" && col !== "id");
  if (sets.length === 0) return null;
  const filter = whereClause(siteId, where, driver);
  return {
    sql:
      `UPDATE ${quoteIdent(table, driver)} SET ${sets.map(([col]) => `${quoteIdent(col, driver)} = ?`).join(", ")}` +
      ` WHERE ${filter.sql}`,
    params: [...sets.map(([, value]) => value), ...filter.params],
  };
}

export function incrementRows(
  table: string,
  siteId: string,
  where: PluginRowMatch,
  deltas: Record<string, number>,
  options: PluginRowIncrementOptions | undefined,
  driver: PluginDatabaseDriver,
): RowStatement | null {
  requireFilter(where, "increment");
  const changes = Object.entries(deltas).filter(([col]) => col !== "site_id" && col !== "id");
  for (const [col, delta] of changes) {
    if (!Number.isSafeInteger(delta)) throw new Error(`Increment for "${col}" must be an integer`);
  }
  const sets = entries(options?.set).filter(
    ([col]) => col !== "site_id" && col !== "id" && !(col in deltas),
  );
  if (changes.length === 0 && sets.length === 0) return null;
  const filter = whereClause(siteId, where, driver);
  const guards: string[] = [];
  const guardParams: PluginRowValue[] = [];
  for (const [col, min] of Object.entries(options?.min ?? {})) {
    if (!Number.isSafeInteger(min)) throw new Error(`Minimum for "${col}" must be an integer`);
    const delta = deltas[col] ?? 0;
    guards.push(`${quoteIdent(col, driver)} + ? >= ?`);
    guardParams.push(delta, min);
  }
  return {
    sql:
      `UPDATE ${quoteIdent(table, driver)} SET ` +
      [
        ...changes.map(([col]) => `${quoteIdent(col, driver)} = ${quoteIdent(col, driver)} + ?`),
        ...sets.map(([col]) => `${quoteIdent(col, driver)} = ?`),
      ].join(", ") +
      ` WHERE ${filter.sql}` +
      guards.map((guard) => ` AND ${guard}`).join(""),
    params: [
      ...changes.map(([, delta]) => delta),
      ...sets.map(([, value]) => value),
      ...filter.params,
      ...guardParams,
    ],
  };
}

export function deleteRows(
  table: string,
  siteId: string,
  where: PluginRowMatch,
  driver: PluginDatabaseDriver,
): RowStatement {
  requireFilter(where, "delete");
  const filter = whereClause(siteId, where, driver);
  return { sql: `DELETE FROM ${quoteIdent(table, driver)} WHERE ${filter.sql}`, params: filter.params };
}

/** MySQL/MariaDB duplicate key. */
export function isDuplicateKeyError(err: unknown): boolean {
  const e = err as { code?: unknown; errno?: unknown } | null;
  return e?.code === "ER_DUP_ENTRY" || e?.errno === 1062;
}

/** Deadlock or serialization failure: the whole transaction may be retried. */
export function isRetryableTransactionError(err: unknown): boolean {
  const e = err as { code?: unknown; errno?: unknown } | null;
  return (
    e?.code === "40001" ||
    e?.code === "40P01" ||
    e?.code === "ER_LOCK_DEADLOCK" ||
    e?.errno === 1213
  );
}
