// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from "vitest";
import {
  clearDiagnosticErrorsForTests,
  createRequestId,
  debugMode,
  recentDiagnosticErrors,
  recordDiagnosticError,
  redactDiagnosticValue,
  runWithRequestId,
} from "../diagnostics.js";

afterEach(() => {
  clearDiagnosticErrorsForTests();
  delete process.env.JF_DEBUG;
  delete process.env.JF_DEBUG_EXPIRES_AT;
  delete process.env.NODE_ENV;
});

describe("diagnostic redaction", () => {
  it("recursively removes known secret classes without changing safe metadata", () => {
    expect(redactDiagnosticValue({
      plugin: "example",
      authorization: "Bearer abc",
      nested: { databaseUrl: "postgres://user:pass@db/site", api_key: "abc" },
      cookies: [{ token: "secret", name: "session" }],
    })).toEqual({
      plugin: "example",
      authorization: "[REDACTED]",
      nested: { databaseUrl: "[REDACTED]", api_key: "[REDACTED]" },
      cookies: "[REDACTED]",
    });
  });

  it("redacts credentials embedded in connection URLs and private keys", () => {
    expect(redactDiagnosticValue("postgres://user:pass@db/site")).toBe("[REDACTED]");
    expect(redactDiagnosticValue("-----BEGIN PRIVATE KEY-----\nsecret")).toBe("[REDACTED]");
  });

  it("redacts credentials embedded in otherwise safe error messages", () => {
    expect(redactDiagnosticValue("provider failed token=abc123 authorization: Bearer-value"))
      .toBe("provider failed token=[REDACTED] authorization=[REDACTED]");
    expect(redactDiagnosticValue("request used Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature"))
      .toBe("request used Bearer [REDACTED]");
  });
});

describe("request diagnostics", () => {
  it("accepts only bounded safe incoming request IDs", () => {
    expect(createRequestId("trace-123456")).toBe("trace-123456");
    expect(createRequestId("bad\nheader")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("associates sanitized errors with the active request", () => {
    runWithRequestId("request-123", () => recordDiagnosticError("provider", new Error("failed\nsecret")));
    expect(recentDiagnosticErrors()[0]).toMatchObject({
      requestId: "request-123",
      context: "provider",
      message: "failed secret",
    });
  });

  it("expires production debug mode", () => {
    process.env.NODE_ENV = "production";
    process.env.JF_DEBUG = "true";
    process.env.JF_DEBUG_EXPIRES_AT = "2000-01-01T00:00:00.000Z";
    expect(debugMode()).toEqual({ enabled: false, production: true, expiresAt: "2000-01-01T00:00:00.000Z" });
  });
});
