import { apiPost } from "../api.js";

export async function updateCommand(_args: string[]): Promise<void> {
  console.log("Checking for updates…");
  const result = await apiPost<{ upToDate: boolean; available?: string; currentVersion: string }>("/api/updates/check", {});

  if (result.upToDate) {
    console.log(`✓ Justflows v${result.currentVersion} is up to date`);
  } else {
    console.log(`Update available: v${result.currentVersion} → v${result.available}`);
    console.log("Run the update from the admin dashboard: /admin/updates");
  }
}
