import { describe, it, expect } from "vitest";
import { loadConfig } from "../config/loader.js";

const base = {
  NODE_ENV: "test",
  PORT: "4000",
  HOST: "127.0.0.1",
  APP_URL: "http://localhost:4000",
  APP_SECRET: "a-very-long-secret-key-that-is-at-least-32-chars",
  DATABASE_URL: "postgres://user:pass@localhost:5432/justflows",
};

describe("loadConfig", () => {
  it("parses valid env vars", () => {
    const config = loadConfig(base);
    expect(config.port).toBe(4000);
    expect(config.env).toBe("test");
    expect(config.database.url).toBe("postgres://user:pass@localhost:5432/justflows");
    expect(config.storage.driver).toBe("local");
    expect(config.cache.driver).toBe("filesystem");
    expect(config.cache.enabled).toBe(false);
  });

  it("disables cache when CACHE_ENABLED=0", () => {
    const config = loadConfig({ ...base, CACHE_ENABLED: "0" });
    expect(config.cache.enabled).toBe(false);
  });

  it("uses memory driver when CACHE_DRIVER=memory", () => {
    const config = loadConfig({ ...base, CACHE_DRIVER: "memory" });
    expect(config.cache.driver).toBe("memory");
  });

  it("uses filesystem driver when CACHE_DRIVER=filesystem", () => {
    const config = loadConfig({ ...base, CACHE_DRIVER: "filesystem", CACHE_DIR: "./tmp/cache" });
    expect(config.cache.driver).toBe("filesystem");
    expect(config.cache.dir).toBe("./tmp/cache");
  });

  it("parses mysql when DATABASE_DRIVER=mysql", () => {
    const config = loadConfig({
      ...base,
      DATABASE_DRIVER: "mysql",
      DATABASE_URL: "mysql://user:pass@localhost:3306/justflows",
    });
    expect(config.database.driver).toBe("mysql");
    expect(config.database.url).toBe("mysql://user:pass@localhost:3306/justflows");
  });

  it("accepts DB_DRIVER when DATABASE_DRIVER is unset", () => {
    const config = loadConfig({
      ...base,
      DB_DRIVER: "mariadb",
      DATABASE_URL: "mariadb://user:pass@localhost:3306/justflows",
    });
    expect(config.database.driver).toBe("mariadb");
  });

  it("throws on missing required fields", () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: undefined })).toThrow();
  });

  it("throws on short secret", () => {
    expect(() => loadConfig({ ...base, APP_SECRET: "tooshort" })).toThrow();
  });

  it("rejects documented example secrets in production", () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: "production",
        APP_SECRET: "please-change-me-to-a-long-random-string-at-least-32-chars",
      }),
    ).toThrow();
  });

  it("throws on invalid URL", () => {
    expect(() => loadConfig({ ...base, APP_URL: "not-a-url" })).toThrow();
  });

  it("throws when database driver/url scheme do not match", () => {
    expect(() =>
      loadConfig({
        ...base,
        DATABASE_DRIVER: "mariadb",
        DATABASE_URL: "postgres://user:pass@localhost:5432/justflows",
      }),
    ).toThrow();
  });
});
