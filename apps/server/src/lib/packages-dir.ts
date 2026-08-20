import path from "node:path";
import { getJfRoot } from "./jf-root.js";

export function packagesInstalledDir(): string {
  const rel = process.env.PACKAGES_DIR ?? "packages-installed";
  return path.isAbsolute(rel) ? rel : path.join(getJfRoot(), rel);
}
