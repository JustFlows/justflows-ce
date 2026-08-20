import fs from "node:fs";
import path from "node:path";

/**
 * Justflows repo root — where server.js, migrations/, and .env live.
 * Set by root server.js on Plesk. Auto-detected in dev.
 */
export function getJfRoot(): string {
  if (process.env.JF_ROOT) return process.env.JF_ROOT;

  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const hasServer = fs.existsSync(path.join(dir, "server.js"));
    const hasMigrations = fs.existsSync(path.join(dir, "migrations"));
    if (hasServer && hasMigrations) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return process.cwd();
}

export function envFilePath(): string {
  return path.join(getJfRoot(), ".env");
}

export function migrationsDir(): string {
  return path.join(getJfRoot(), "migrations");
}

export function uploadsDir(): string {
  const rel = process.env.STORAGE_LOCAL_PATH ?? "uploads";
  return path.isAbsolute(rel) ? rel : path.join(getJfRoot(), rel);
}

/** EJS templates — works with bundled server, dist/routes, and dev src. */
export function viewsDir(): string {
  const root = getJfRoot();
  for (const rel of ["apps/server/dist/views", "apps/server/src/views"]) {
    const dir = path.join(root, rel);
    if (
      fs.existsSync(path.join(dir, "layout.ejs")) &&
      fs.existsSync(path.join(dir, "partials", "header.ejs"))
    ) {
      return dir;
    }
  }
  return path.join(root, "apps/server/src/views");
}
