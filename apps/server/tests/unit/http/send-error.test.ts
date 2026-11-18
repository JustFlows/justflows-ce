// SPDX-License-Identifier: MIT
import type { Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { describeZodError, sendInputOrServerError, sendServerError } from "../../../src/lib/http/send-error.js";
import { InvalidInputError } from "../../../src/lib/http/invalid-input-error.js";
import { sanitizeCustomCss } from "../../../src/lib/rendering/safe-css.js";
import { QuotaRefusalError } from "../../../src/lib/tenancy/quotas.js";
afterEach(() => vi.restoreAllMocks());
function response() {
  const result = { headersSent: false, status: vi.fn(), json: vi.fn() };
  result.status.mockReturnValue(result);
  return result;
}
describe("storage refusal responses", () => {
  it("reports actionable quota errors without treating them as unexpected server failures", () => {
    const res = response();
    sendServerError(res as unknown as Response, "storage move", new QuotaRefusalError({ status: 409, error: "Storage limit exceeded", code: "quota_exceeded", meter: "storage.bytes" }));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "Storage limit exceeded", code: "quota_exceeded", meter: "storage.bytes" });
  });
  it("keeps unexpected internal details out of API responses", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = response(); sendServerError(res as unknown as Response, "storage", new Error("internal filesystem details"));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Internal server error" }));
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("internal filesystem details");
  });
});

/** Design routes answer fixable input with 400 and everything else generically (justflows-ce#315). */
describe("input or server errors", () => {
  it("names each schema problem with its field, and counts the rest", () => {
    const schema = z.object({ patterns: z.array(z.object({ title: z.string() })) });
    const result = schema.safeParse({ patterns: [{}, {}, {}, {}, {}] });
    expect(result.success).toBe(false);
    expect(describeZodError(result.error!)).toMatch(/^patterns\.0\.title: .+; patterns\.1\.title: .+; patterns\.2\.title: .+; and 2 more problems$/);
  });

  it("answers a Zod refusal with 400 and a readable message", () => {
    const res = response();
    const parsed = z.object({ name: z.string() }).safeParse({});
    sendInputOrServerError(res as unknown as Response, "test", parsed.error);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0]?.[0]?.error).toMatch(/^name: /);
  });

  it("keeps the message of input the caller can fix, such as refused custom CSS", () => {
    const res = response();
    let thrown: unknown;
    try {
      sanitizeCustomCss("body { background: url(javascript:alert(1)) }");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(InvalidInputError);
    sendInputOrServerError(res as unknown as Response, "test", thrown);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Custom CSS contains disallowed constructs" });
  });

  it("logs anything else and answers with a generic message", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = response();
    sendInputOrServerError(res as unknown as Response, "test", new Error("ER_LOCK_DEADLOCK on db-internal-7"));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("db-internal");
  });

  it("does not answer twice", () => {
    const res = { ...response(), headersSent: true };
    sendInputOrServerError(res as unknown as Response, "test", new InvalidInputError("x"));
    expect(res.status).not.toHaveBeenCalled();
  });
});
