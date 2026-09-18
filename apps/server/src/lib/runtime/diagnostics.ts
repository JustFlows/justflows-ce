// SPDX-License-Identifier: MIT

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface DiagnosticError {
  id: string;
  timestamp: string;
  requestId: string | null;
  context: string;
  message: string;
}

export interface RequestDiagnosticTrace {
  requestId: string;
  startedAt: number;
  databaseQueries: number;
  databaseMs: number;
}

const requestContext = new AsyncLocalStorage<RequestDiagnosticTrace>();
const errors: DiagnosticError[] = [];
export interface CompletedRequestTrace {
  requestId: string;
  timestamp: string;
  path: string;
  durationMs: number;
  pageCache: string;
  pageCacheReason?: string | null;
  objectCache: string;
  databaseQueries: number;
  databaseMs: number;
  hookRuns: number;
  hookErrors: number;
  theme: string;
  template: string;
}
const traces: CompletedRequestTrace[] = [];

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function diagnosticsRetentionLimit(): number {
  return boundedInt(process.env.DIAGNOSTICS_ERROR_LIMIT, 100, 10, 1_000);
}

export function debugMode(): { enabled: boolean; production: boolean; expiresAt: string | null } {
  const enabled = ["1", "true", "on", "yes"].includes((process.env.JF_DEBUG ?? "").toLowerCase());
  const expiresAt = process.env.JF_DEBUG_EXPIRES_AT?.trim() || null;
  const expired = expiresAt !== null && !Number.isNaN(Date.parse(expiresAt)) && Date.parse(expiresAt) <= Date.now();
  return { enabled: enabled && !expired, production: process.env.NODE_ENV === "production", expiresAt };
}

export function createRequestId(incoming: string | undefined): string {
  const candidate = incoming?.trim();
  return candidate && /^[A-Za-z0-9._:-]{8,128}$/.test(candidate) ? candidate : randomUUID();
}

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestContext.run(
    { requestId, startedAt: performance.now(), databaseQueries: 0, databaseMs: 0 },
    fn,
  );
}

export function currentRequestId(): string | null {
  return requestContext.getStore()?.requestId ?? null;
}

export function recordDatabaseTiming(durationMs: number): void {
  const trace = requestContext.getStore();
  if (!trace) return;
  trace.databaseQueries += 1;
  trace.databaseMs += durationMs;
}

export function currentRequestTrace(): RequestDiagnosticTrace | null {
  const trace = requestContext.getStore();
  return trace ? { ...trace } : null;
}

const SENSITIVE_KEY = /(authorization|cookie|password|passwd|secret|token|api.?key|private.?key|connection.?url|database.?url)/i;

export function redactDiagnosticValue(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) return "[REDACTED]";
    if (/^[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/i.test(value)) return "[REDACTED]";
    return value
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
      .replace(/\b(password|passwd|secret|token|api[_-]?key|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
      .replace(/[\r\n]/g, " ")
      .slice(0, 2_000);
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactDiagnosticValue(item, key, seen));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).slice(0, 200).map(([childKey, child]) => [
      childKey,
      redactDiagnosticValue(child, childKey, seen),
    ]),
  );
}

export function recordDiagnosticError(context: string, error: unknown): DiagnosticError {
  const raw = error instanceof Error ? error.message : String(error);
  const entry: DiagnosticError = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    requestId: currentRequestId(),
    context: String(redactDiagnosticValue(context)).slice(0, 128),
    message: String(redactDiagnosticValue(raw)).slice(0, 2_000),
  };
  errors.unshift(entry);
  errors.splice(diagnosticsRetentionLimit());
  return entry;
}

export function recentDiagnosticErrors(): DiagnosticError[] {
  return errors.map((entry) => ({ ...entry }));
}

export function recordCompletedRequestTrace(trace: CompletedRequestTrace): void {
  traces.unshift(redactDiagnosticValue(trace) as CompletedRequestTrace);
  traces.splice(100);
}

export function recentRequestTraces(): CompletedRequestTrace[] {
  return traces.map((trace) => ({ ...trace }));
}

export function clearDiagnosticErrorsForTests(): void {
  errors.splice(0);
  traces.splice(0);
}
