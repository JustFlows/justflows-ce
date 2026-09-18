import fs from "node:fs";
import path from "node:path";

/**
 * Absolute path to `npm` alongside the currently running `node` binary.
 * Every node distribution (nodenv, nvm, plain installs) ships npm in the same
 * `bin/` directory as `node` itself, so this resolves correctly even when the
 * host process's PATH has no working node version manager shim for the
 * current working directory (e.g. Passenger launched with an absolute node
 * path and no `.node-version` / `nodenv global` set for the app root) — the
 * case that produces "nodenv: npm: command not found" on hosts where a node
 * version is installed but none is selected for this directory.
 */
export function resolveNpmBin(): string {
  const candidate = path.join(path.dirname(process.execPath), "npm");
  return fs.existsSync(candidate) ? candidate : "npm";
}
