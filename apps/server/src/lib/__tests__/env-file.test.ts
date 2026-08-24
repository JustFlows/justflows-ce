import { describe, expect, it } from "vitest";
import { assertSafeEnvValue } from "../env-file.js";

describe("assertSafeEnvValue", () => {
  it("accepts ordinary values", () => {
    for (const value of ["https://example.com", "s3cr3t-p@ss w0rd!", "", "a=b=c"]) {
      expect(() => assertSafeEnvValue("K", value)).not.toThrow();
    }
  });

  it("rejects a newline that would inject another assignment", () => {
    // dotenv keeps the first occurrence of a key, and APP_URL is written to .env
    // before the generated APP_SECRET — so this would let the caller pick the
    // session signing key.
    expect(() =>
      assertSafeEnvValue("APP_URL", "https://x\nAPP_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ).toThrow(/line breaks/);
  });

  it("rejects carriage returns and null bytes", () => {
    expect(() => assertSafeEnvValue("DB_PASSWORD", "a\rb")).toThrow();
    expect(() => assertSafeEnvValue("DB_PASSWORD", "a\0b")).toThrow();
  });

  it("names the offending key so the error is actionable", () => {
    expect(() => assertSafeEnvValue("CACHE_DIR", "x\ny")).toThrow(/CACHE_DIR/);
  });
});
