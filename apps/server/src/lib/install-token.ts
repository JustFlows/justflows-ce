// SPDX-License-Identifier: MIT

import { createRequire } from "node:module";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { getJfRoot } from "./jf-root.js";

/**
 * First-run install token.
 *
 * Until setup completes, POST /api/install is reachable by anyone who can reach
 * the port, and whoever calls it first becomes the administrator. The token
 * proves the caller controls the server rather than merely knowing the address.
 *
 * File minting lives in `scripts/install-token.cjs` so root `server.js` can
 * write `install-token/TOKEN.txt` before the Express app boots.
 */

type InstallTokenCjs = {
  installTokenRequired: (env?: NodeJS.ProcessEnv) => boolean;
  installTokenDir: (root: string) => string;
  installTokenFile: (root: string) => string;
  installTokenFileExists: (root: string) => boolean;
  ensureInstallToken: (root: string, env?: NodeJS.ProcessEnv) => string;
  clearInstallToken: (root: string) => void;
  resetInstallTokenCache: () => void;
};

function loadCjs(): InstallTokenCjs {
  const file = path.join(getJfRoot(), "scripts", "install-token.cjs");
  return createRequire(file)(file) as InstallTokenCjs;
}

export function installTokenDir(root = getJfRoot()): string {
  return loadCjs().installTokenDir(root);
}

export function installTokenFile(root = getJfRoot()): string {
  return loadCjs().installTokenFile(root);
}

/**
 * The active token, generating and persisting one on first use.
 *
 * Reads back an existing file so the token survives a restart mid-install —
 * common on shared hosting, where Passenger recycles the process freely and a
 * regenerated token would invalidate the one the user is holding.
 */
export function installToken(root = getJfRoot()): string {
  return loadCjs().ensureInstallToken(root);
}

/** Whether the token gate applies at all. */
export function installTokenRequired(): boolean {
  return loadCjs().installTokenRequired();
}

/**
 * Loopback callers are exempt.
 *
 * Reaching the port from the machine itself already implies local access, so
 * demanding the token would be friction with no security benefit — and this is
 * the normal case for `npm run dev`.
 */
export function isLoopbackAddress(ip: string | undefined): boolean {
  if (!ip) return false;
  const addr = ip.replace(/^::ffff:/, "");
  return addr === "127.0.0.1" || addr === "::1" || addr.startsWith("127.");
}

export function tokenMatches(supplied: string | undefined, root = getJfRoot()): boolean {
  const expected = Buffer.from(installToken(root));
  const given = Buffer.from(supplied ?? "");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Remove the token directory once it can no longer be needed. */
export function clearInstallToken(root = getJfRoot()): void {
  loadCjs().clearInstallToken(root);
}

/** Whether a token file is currently on disk, so the UI can say where to look. */
export function installTokenFileExists(root = getJfRoot()): boolean {
  return loadCjs().installTokenFileExists(root);
}

/** Reset between tests. */
export function resetInstallTokenCache(): void {
  loadCjs().resetInstallTokenCache();
}
