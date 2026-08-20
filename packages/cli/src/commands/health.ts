import { apiGet } from "../api.js";

interface HealthReport {
  status: string;
  checks: Array<{ name: string; status: string; message: string }>;
  uptime: number;
}

export async function healthCommand(_args: string[]): Promise<void> {
  const report = await apiGet<HealthReport>("/api/health");
  const icon = report.status === "ok" ? "✅" : report.status === "warn" ? "⚠️" : "❌";
  console.log(`\n${icon} Site health: ${report.status.toUpperCase()}\n`);

  for (const check of report.checks) {
    const c = check.status === "ok" ? "✓" : check.status === "warn" ? "⚠" : "✗";
    const color = check.status === "ok" ? "\x1b[32m" : check.status === "warn" ? "\x1b[33m" : "\x1b[31m";
    console.log(`  ${color}${c}\x1b[0m ${check.name.padEnd(20)} ${check.message}`);
  }

  console.log(`\n  Uptime: ${Math.floor(report.uptime / 60)}m ${report.uptime % 60}s`);

  if (report.status === "error") process.exitCode = 1;
}
