import { apiPost } from "../api.js";

export async function cacheCommand(args: string[]): Promise<void> {
  const [sub] = args;

  if (sub === "clear") {
    await apiPost("/api/cache/clear", {});
    console.log("✓ Cache cleared");
  } else {
    console.log("Usage: justflows cache clear");
  }
}
