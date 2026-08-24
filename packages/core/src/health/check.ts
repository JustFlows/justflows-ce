export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
}

export interface HealthReport {
  status: HealthStatus;
  version: string;
  uptime: number;
  timestamp: string;
  checks: HealthCheckResult[];
}

export type HealthChecker = () => Promise<HealthCheckResult>;

export class HealthMonitor {
  private readonly checkers = new Map<string, HealthChecker>();
  private readonly startedAt = Date.now();
  private readonly version: string;

  constructor(version = "0.1.2") {
    this.version = version;
  }

  register(name: string, checker: HealthChecker): void {
    this.checkers.set(name, checker);
  }

  async check(): Promise<HealthReport> {
    const results = await Promise.all(
      Array.from(this.checkers.entries()).map(async ([name, fn]) => {
        const start = Date.now();
        try {
          const result = await fn();
          return { ...result, name, latencyMs: Date.now() - start };
        } catch (err) {
          return {
            name,
            status: "unhealthy" as HealthStatus,
            latencyMs: Date.now() - start,
            message: String(err),
          };
        }
      }),
    );

    const status = deriveOverallStatus(results);

    return {
      status,
      version: this.version,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      checks: results,
    };
  }
}

function deriveOverallStatus(checks: HealthCheckResult[]): HealthStatus {
  if (checks.some((c) => c.status === "unhealthy")) return "unhealthy";
  if (checks.some((c) => c.status === "degraded")) return "degraded";
  return "healthy";
}
