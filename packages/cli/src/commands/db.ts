import { apiPost } from "../api.js";

export async function dbCommand(args: string[]): Promise<void> {
  const [sub] = args;

  if (sub === "migrate") {
    console.log("Running database migrations…");
    const result = await apiPost<{ ok: boolean; applied?: number; skipped?: number }>(
      "/api/db/migrate",
      {},
    );
    const applied = result.applied ?? 0;
    const skipped = result.skipped ?? 0;
    console.log(
      `✓ Migrations applied: ${applied}${skipped ? ` · already current: ${skipped}` : ""}`,
    );
  } else {
    console.log("Usage: justflows db migrate");
  }
}
