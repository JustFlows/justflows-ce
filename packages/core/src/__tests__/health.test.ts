import { describe, it, expect } from "vitest";
import { HealthMonitor } from "../health/check.js";

describe("HealthMonitor", () => {
  it("reports healthy when all checks pass", async () => {
    const monitor = new HealthMonitor("0.1.0");
    monitor.register("db", async () => ({ name: "db", status: "healthy" }));
    const report = await monitor.check();
    expect(report.status).toBe("healthy");
    expect(report.checks).toHaveLength(1);
  });

  it("reports unhealthy if any check is unhealthy", async () => {
    const monitor = new HealthMonitor();
    monitor.register("db", async () => ({ name: "db", status: "unhealthy", message: "connection refused" }));
    monitor.register("cache", async () => ({ name: "cache", status: "healthy" }));
    const report = await monitor.check();
    expect(report.status).toBe("unhealthy");
  });

  it("reports degraded if any check is degraded but none unhealthy", async () => {
    const monitor = new HealthMonitor();
    monitor.register("storage", async () => ({ name: "storage", status: "degraded" }));
    const report = await monitor.check();
    expect(report.status).toBe("degraded");
  });

  it("catches check errors and marks them unhealthy", async () => {
    const monitor = new HealthMonitor();
    monitor.register("db", async () => { throw new Error("timeout"); });
    const report = await monitor.check();
    expect(report.status).toBe("unhealthy");
    expect(report.checks[0]?.message).toContain("timeout");
  });
});
