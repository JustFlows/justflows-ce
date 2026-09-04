// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyFormCors, isAllowedFormOrigin } from "../cors.js";

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.APP_URL;
  delete process.env.STATIC_EXPORT_BASE_URL;
  delete process.env.STATIC_EXPORT_ALLOWED_ORIGINS;
  process.env.NODE_ENV = "test";
});
afterEach(() => {
  process.env = { ...saved };
});

describe("isAllowedFormOrigin", () => {
  it("rejects a missing origin", () => {
    expect(isAllowedFormOrigin(undefined)).toBe(false);
    expect(isAllowedFormOrigin("")).toBe(false);
  });

  it("allows APP_URL and STATIC_EXPORT_BASE_URL regardless of trailing slash / case", () => {
    process.env.APP_URL = "https://www.example.com/";
    expect(isAllowedFormOrigin("https://WWW.example.com")).toBe(true);
    process.env.STATIC_EXPORT_BASE_URL = "https://cdn.example.com";
    expect(isAllowedFormOrigin("https://cdn.example.com")).toBe(true);
  });

  it("allows entries from STATIC_EXPORT_ALLOWED_ORIGINS", () => {
    process.env.STATIC_EXPORT_ALLOWED_ORIGINS = "https://a.example.com, https://b.example.com";
    expect(isAllowedFormOrigin("https://b.example.com")).toBe(true);
    expect(isAllowedFormOrigin("https://c.example.com")).toBe(false);
  });

  it("allows any localhost port off production", () => {
    process.env.NODE_ENV = "development";
    expect(isAllowedFormOrigin("http://localhost:49936")).toBe(true);
    expect(isAllowedFormOrigin("http://127.0.0.1:5173")).toBe(true);
    process.env.NODE_ENV = "production";
    expect(isAllowedFormOrigin("http://localhost:49936")).toBe(false);
  });

  it("does not vouch for loopback on a proxied host even when NODE_ENV is unset", () => {
    delete process.env.NODE_ENV;
    process.env.PASSENGER_APP_ENV = "production";
    try {
      expect(isAllowedFormOrigin("http://localhost:49936")).toBe(false);
    } finally {
      delete process.env.PASSENGER_APP_ENV;
    }
  });
});

describe("applyFormCors", () => {
  it("sets headers and returns true for an allowed origin", () => {
    process.env.APP_URL = "https://www.example.com";
    const headers: Record<string, string> = {};
    const ok = applyFormCors("https://www.example.com", (n, v) => (headers[n] = v));
    expect(ok).toBe(true);
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://www.example.com");
    expect(headers["Access-Control-Allow-Methods"]).toContain("POST");
  });

  it("returns false and sets nothing for a disallowed origin", () => {
    const headers: Record<string, string> = {};
    const ok = applyFormCors("https://evil.example.com", (n, v) => (headers[n] = v));
    expect(ok).toBe(false);
    expect(Object.keys(headers)).toHaveLength(0);
  });
});
