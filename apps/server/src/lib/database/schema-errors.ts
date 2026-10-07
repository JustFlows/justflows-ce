// SPDX-License-Identifier: MIT

/**
 * Recognise "this schema object does not exist yet" errors from PostgreSQL,
 * MySQL and MariaDB, so legacy-schema fallbacks only trigger on a genuinely
 * older database and never on a timeout, lost connection or permission error.
 */

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

export function isMissingTableError(error: unknown): boolean {
  const code = errorCode(error);
  if (code === "42P01" || code === "ER_NO_SUCH_TABLE") return true;
  return code === undefined && /no such table|relation .* does not exist|table .* doesn't exist/i.test(errorMessage(error));
}

export function isMissingColumnError(error: unknown): boolean {
  const code = errorCode(error);
  if (code === "42703" || code === "ER_BAD_FIELD_ERROR") return true;
  return code === undefined && /no such column|column .* does not exist|unknown column/i.test(errorMessage(error));
}
