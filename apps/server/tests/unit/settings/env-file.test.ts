import { describe, expect, it } from "vitest";
import { assertSafeEnvValue, mergeEnvLines } from "../../../src/lib/settings/env-file.js";

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

describe("mergeEnvLines", () => {
  const file = [
    "# Storage",
    "STORAGE_DRIVER=local",
    "",
    "# Responsive images",
    "JF_IMAGE_FORMATS=webp,avif",
    "JF_IMAGE_QUALITY_WEBP=82",
    "JF_IMAGE_QUALITY_AVIF=50",
    "JF_IMAGE_QUALITY_JPEG=82",
    "JF_IMAGE_THUMB=400x400",
    "# JF_IMAGE_KEEP_ORIGINAL=logo*,*.svg",
    "",
    "# Cache",
    "CACHE_ENABLED=0",
    "CACHE_DIR=./.cache",
    "",
    "PORT=3000",
  ];

  it("puts a new key right after the key before it in the update", () => {
    const out = mergeEnvLines(file, {
      JF_IMAGE_QUALITY_AVIF: "50",
      JF_IMAGE_AVIF_EFFORT: "2",
      JF_IMAGE_QUALITY_JPEG: "82",
    });
    expect(out.slice(6, 9)).toEqual(["JF_IMAGE_QUALITY_AVIF=50", "JF_IMAGE_AVIF_EFFORT=2", "JF_IMAGE_QUALITY_JPEG=82"]);
    expect(out.at(-1)).toBe("PORT=3000");
  });

  it("fills a commented placeholder instead of adding a second line", () => {
    const out = mergeEnvLines(file, { JF_IMAGE_KEEP_ORIGINAL: "logo*" });
    expect(out).toContain("JF_IMAGE_KEEP_ORIGINAL=logo*");
    expect(out.some((line) => line.startsWith("# JF_IMAGE_KEEP_ORIGINAL"))).toBe(false);
    expect(out).toHaveLength(file.length);
  });

  it("falls back to the end of the key's prefix group", () => {
    const out = mergeEnvLines(file, { CACHE_TTL_SECONDS: "300" });
    expect(out.indexOf("CACHE_TTL_SECONDS=300")).toBe(out.indexOf("CACHE_DIR=./.cache") + 1);
  });

  it("groups JF_ keys by their second segment, not by JF alone", () => {
    const image = mergeEnvLines(file, { JF_IMAGE_MAX_WIDTH: "2560" });
    expect(image.indexOf("JF_IMAGE_MAX_WIDTH=2560")).toBe(image.indexOf("# JF_IMAGE_KEEP_ORIGINAL=logo*,*.svg") + 1);
    // No JF_GZIP_* group yet: it starts at the end rather than joining JF_IMAGE_*.
    expect(mergeEnvLines(file, { JF_GZIP_LEVEL: "6" }).at(-1)).toBe("JF_GZIP_LEVEL=6");
  });

  it("appends an unrelated key at the end, after one blank line", () => {
    const out = mergeEnvLines([...file, "", ""], { STATIC_EXPORT_ENABLED: "1" });
    expect(out.slice(-3)).toEqual(["PORT=3000", "", "STATIC_EXPORT_ENABLED=1"]);
  });

  it("updates in place and removes null keys", () => {
    const out = mergeEnvLines(file, { JF_IMAGE_THUMB: "off", CACHE_DIR: null });
    expect(out).toContain("JF_IMAGE_THUMB=off");
    expect(out.some((line) => line.startsWith("CACHE_DIR="))).toBe(false);
  });
});
