import fs from "node:fs";
import path from "node:path";
import { getJfRoot } from "./jf-root.js";

let cached: string | undefined;

/** Installed Justflows version from the root package.json. */
export function getJustflowsVersion(): string {
  if (cached) return cached;
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(getJfRoot(), "package.json"), "utf-8"),
    ) as { version?: string };
    cached = pkg.version ?? "unknown";
  } catch {
    cached = "unknown";
  }
  return cached;
}
