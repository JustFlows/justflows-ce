import { describe, it, expect, vi } from "vitest";
import { App } from "../lifecycle/app.js";
import type { AppConfig } from "../config/schema.js";

const testConfig: AppConfig = {
  env: "test",
  port: 4000,
  host: "127.0.0.1",
  url: "http://localhost:4000",
  secret: "a-very-long-secret-key-that-is-at-least-32-chars",
  logLevel: "error",
  database: {
    driver: "postgres",
    url: "postgres://user:pass@localhost:5432/test",
    poolMin: 1,
    poolMax: 2,
    ssl: false,
  },
  storage: { driver: "local", localPath: "./uploads" },
  cache: { enabled: true, driver: "memory", ttlSeconds: 60 },
};

describe("App lifecycle", () => {
  it("starts and stops cleanly", async () => {
    const app = new App(testConfig);
    expect(app.state).toBe("created");
    await app.start();
    expect(app.state).toBe("running");
    await app.stop();
    expect(app.state).toBe("stopped");
  });

  it("fires app.starting and app.started hooks on start", async () => {
    const app = new App(testConfig);
    const startingFn = vi.fn();
    const startedFn = vi.fn();
    app.hooks.action("app.starting", startingFn);
    app.hooks.action("app.started", startedFn);
    await app.start();
    expect(startingFn).toHaveBeenCalled();
    expect(startedFn).toHaveBeenCalled();
    await app.stop();
  });

  it("fires app.stopping hook on stop", async () => {
    const app = new App(testConfig);
    const stoppingFn = vi.fn();
    app.hooks.action("app.stopping", stoppingFn);
    await app.start();
    await app.stop();
    expect(stoppingFn).toHaveBeenCalled();
  });

  it("throws if started twice", async () => {
    const app = new App(testConfig);
    await app.start();
    await expect(app.start()).rejects.toThrow();
    await app.stop();
  });

  it("returns a health report", async () => {
    const app = new App(testConfig);
    await app.start();
    const report = await app.healthCheck();
    expect(report.status).toBe("healthy");
    expect(typeof report.uptime).toBe("number");
    await app.stop();
  });
});
