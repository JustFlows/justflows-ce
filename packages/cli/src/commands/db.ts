import { apiPost } from "../api.js";

export async function dbCommand(args: string[]): Promise<void> {
  const [sub] = args;

  if (sub === "migrate") {
    console.log("Running database migrations…");
    const result = await apiPost<{ ok: boolean; applied: number }>("/api/db/migrate", {});
    console.log(`✓ Migrations applied: ${result.applied}`);
  } else {
    console.log("Usage: justflows db migrate");
  }
}
