import { apiGet } from "../api.js";

export async function statusCommand(_args: string[]): Promise<void> {
  console.log("Checking Justflows installation…\n");

  try {
    const health = await apiGet<{ status: string; checks: Array<{ name: string; status: string; message: string }>; uptime: number }>("/api/health");

    const icon = health.status === "ok" ? "✅" : health.status === "warn" ? "⚠️" : "❌";
    console.log(`${icon} Status: ${health.status.toUpperCase()}`);
    console.log(`   Uptime: ${Math.floor(health.uptime / 60)}m ${health.uptime % 60}s\n`);

    for (const check of health.checks) {
      const c = check.status === "ok" ? "✓" : check.status === "warn" ? "⚠" : "✗";
      console.log(`  ${c} ${check.name.padEnd(20)} ${check.message}`);
    }
  } catch (err) {
    console.error(`Cannot reach admin at ${process.env["ADMIN_URL"] ?? "http://localhost:3001"}`);
    console.error(String(err));
    process.exitCode = 1;
  }
}
