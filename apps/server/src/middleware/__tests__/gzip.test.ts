import { describe, expect, it } from "vitest";
import { isGzipCompressibleContentType } from "../gzip.js";

describe("gzip content types", () => {
  it("compresses JSON and HTML", () => {
    expect(isGzipCompressibleContentType("application/json")).toBe(true);
    expect(isGzipCompressibleContentType("text/html; charset=utf-8")).toBe(true);
  });

  it("does not compress server-sent events", () => {
    expect(isGzipCompressibleContentType("text/event-stream")).toBe(false);
    expect(isGzipCompressibleContentType("text/event-stream; charset=utf-8")).toBe(false);
  });
});
