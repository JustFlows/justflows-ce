// SPDX-License-Identifier: MIT
"use strict";

/**
 * First-run install token (Node builtins only).
 *
 * Root `server.js` must mint this before the Express app boots, so shared-hosting
 * File Manager shows `install-token/TOKEN.txt` as soon as Node starts.
 * Keep the file format in sync with apps/server/src/lib/install-token.ts.
 */

const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const TOKEN_DIR = "install-token";
const TOKEN_FILE = "TOKEN.txt";

/** Denies the whole directory on Apache 2.2 and 2.4. */
const HTACCESS = `# Justflows install token — never serve this over HTTP.
<IfModule mod_authz_core.c>
  Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
  Order allow,deny
  Deny from all
</IfModule>
`;

let cached = null;

function installTokenRequired(env = process.env) {
  return env.JUSTFLOWS_SKIP_INSTALL_TOKEN !== "1";
}

function installTokenDir(root) {
  return path.join(root, TOKEN_DIR);
}

function installTokenFile(root) {
  return path.join(installTokenDir(root), TOKEN_FILE);
}

function installTokenFileExists(root) {
  return fs.existsSync(installTokenFile(root));
}

function fileBody(token) {
  return `Justflows — installation token
==============================

  ${token}

Copy the line above into the setup page in your browser to finish installing.

Why this exists: until setup finishes, anyone who can reach this site could
claim it and become its administrator. This file proves the install is being
run by whoever controls the files — you.

Justflows deletes this folder automatically once setup completes. If you
abandon the install, delete it yourself.
`;
}

function ensureInstallToken(root, env = process.env) {
  const configured = (env.JUSTFLOWS_INSTALL_TOKEN ?? "").trim();
  if (configured) return configured;
  if (cached) return cached;

  const file = installTokenFile(root);
  try {
    const existing = fs.readFileSync(file, "utf8").match(/^\s{2}([A-Za-z0-9_-]{16,})\s*$/m);
    if (existing?.[1]) {
      cached = existing[1];
      return cached;
    }
  } catch {
    // No file yet — fall through and mint one.
  }

  const token = randomBytes(24).toString("base64url");
  cached = token;

  try {
    const dir = installTokenDir(root);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".htaccess"), HTACCESS, "utf8");
    fs.writeFileSync(file, fileBody(token), { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(file, 0o600);
    console.log(
      `\n[justflows] Installation token: ${token}\n` +
        `[justflows] Also saved to ${TOKEN_DIR}/${TOKEN_FILE} — open it over FTP or your host's File Manager.\n`,
    );
  } catch (err) {
    console.error(
      `[justflows] Could not write ${TOKEN_DIR}/${TOKEN_FILE} (${String(err)}).\n` +
        `[justflows] Installation token: ${token}`,
    );
  }

  return token;
}

function clearInstallToken(root) {
  cached = null;
  try {
    fs.rmSync(installTokenDir(root), { recursive: true, force: true });
  } catch {
    // Best effort — a leftover token is inert once STATE=INSTALLED.
  }
}

function resetInstallTokenCache() {
  cached = null;
}

module.exports = {
  TOKEN_DIR,
  TOKEN_FILE,
  installTokenRequired,
  installTokenDir,
  installTokenFile,
  installTokenFileExists,
  ensureInstallToken,
  clearInstallToken,
  resetInstallTokenCache,
};
