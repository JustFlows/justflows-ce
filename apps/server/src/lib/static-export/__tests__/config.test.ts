// SPDX-License-Identifier: MIT

import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getStaticExportConfig } from "../config.js";
import { getJfRoot } from "../../jf-root.js";

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.APP_URL;
  delete process.env.STATIC_EXPORT_BASE_URL;
  delete process.env.STATIC_EXPORT_CRAWL_URL;
  delete process.env.STATIC_EXPORT_DIR;
  delete process.env.PORT;
  process.env.NODE_ENV = "test";
});
afterEach(() => {
  process.env = { ...saved };
});

describe("getStaticExportConfig — crawl baseUrl", () => {
  it("defaults to loopback on PORT off production", () => {
    process.env.PORT = "4001";
    expect(getStaticExportConfig().baseUrl).toBe("http://127.0.0.1:4001");
  });

  it("an explicit override wins over everything", () => {
    process.env.NODE_ENV = "production";
    process.env.APP_URL = "https://www.example.com";
    process.env.STATIC_EXPORT_CRAWL_URL = "https://crawl.example.com";
    expect(getStaticExportConfig({ baseUrl: "http://127.0.0.1:9000" }).baseUrl).toBe(
      "http://127.0.0.1:9000",
    );
  });

  it("prefers STATIC_EXPORT_CRAWL_URL when set, trimming a trailing slash", () => {
    process.env.STATIC_EXPORT_CRAWL_URL = "https://crawl.example.com/";
    expect(getStaticExportConfig().baseUrl).toBe("https://crawl.example.com");
  });

  it("on production falls back to APP_URL rather than a loopback IP", () => {
    process.env.NODE_ENV = "production";
    process.env.APP_URL = "https://justflows.example.com";
    expect(getStaticExportConfig().baseUrl).toBe("https://justflows.example.com");
  });

  it("on production uses STATIC_EXPORT_BASE_URL when APP_URL is unset", () => {
    process.env.NODE_ENV = "production";
    process.env.STATIC_EXPORT_BASE_URL = "https://cdn.example.com";
    expect(getStaticExportConfig().baseUrl).toBe("https://cdn.example.com");
  });

  it("off production ignores APP_URL and stays on loopback", () => {
    process.env.NODE_ENV = "development";
    process.env.APP_URL = "https://www.example.com";
    process.env.PORT = "3000";
    expect(getStaticExportConfig().baseUrl).toBe("http://127.0.0.1:3000");
  });
});

describe("getStaticExportConfig — outDir containment", () => {
  const defaultDir = path.resolve(getJfRoot(), "static-export");

  it("resolves a relative STATIC_EXPORT_DIR under the app root", () => {
    process.env.STATIC_EXPORT_DIR = "build/site";
    expect(getStaticExportConfig().outDir).toBe(path.resolve(getJfRoot(), "build/site"));
  });

  it("falls back to the default when the configured dir escapes the app root", () => {
    for (const bad of [".", "..", "../../etc", "/var/www", "/"]) {
      process.env.STATIC_EXPORT_DIR = bad;
      expect(getStaticExportConfig().outDir).toBe(defaultDir);
    }
  });
});
