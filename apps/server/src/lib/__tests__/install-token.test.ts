import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearInstallToken,
  installToken,
  installTokenFile,
  installTokenFileExists,
  installTokenRequired,
  isLoopbackAddress,
  resetInstallTokenCache,
  tokenMatches,
} from "../install-token.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "jf-token-"));
  resetInstallTokenCache();
  delete process.env.JUSTFLOWS_INSTALL_TOKEN;
  delete process.env.JUSTFLOWS_SKIP_INSTALL_TOKEN;
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  resetInstallTokenCache();
  delete process.env.JUSTFLOWS_INSTALL_TOKEN;
  delete process.env.JUSTFLOWS_SKIP_INSTALL_TOKEN;
});

describe("install token file", () => {
  it("writes a token the site owner can reach without a terminal", () => {
    const token = installToken(root);
    const body = fs.readFileSync(installTokenFile(root), "utf8");

    expect(body).toContain(token);
    // The file has to explain itself: whoever opens it over FTP has no other context.
    expect(body).toMatch(/installation token/i);
    expect(installTokenFileExists(root)).toBe(true);
  });

  it("denies the folder to Apache, since the app root is often the docroot", () => {
    installToken(root);
    const htaccess = fs.readFileSync(path.join(root, "install-token", ".htaccess"), "utf8");
    expect(htaccess).toContain("Require all denied");
    expect(htaccess).toContain("Deny from all");
  });

  it("keeps the file owner-only", () => {
    installToken(root);
    expect(fs.statSync(installTokenFile(root)).mode & 0o777).toBe(0o600);
  });

  it("reads the same token back after a restart", () => {
    // Passenger recycles processes freely; regenerating would invalidate the
    // token the user is holding halfway through the wizard.
    const first = installToken(root);
    resetInstallTokenCache();
    expect(installToken(root)).toBe(first);
  });

  it("prefers an operator-supplied token and writes no file", () => {
    process.env.JUSTFLOWS_INSTALL_TOKEN = "provisioned-by-automation"; // scan-secrets:allow
    expect(installToken(root)).toBe("provisioned-by-automation");
    expect(installTokenFileExists(root)).toBe(false);
  });

  it("is removed once it has been spent", () => {
    installToken(root);
    clearInstallToken(root);
    expect(installTokenFileExists(root)).toBe(false);
    expect(fs.existsSync(path.join(root, "install-token"))).toBe(false);
  });
});

describe("tokenMatches", () => {
  it("accepts the real token and nothing else", () => {
    const token = installToken(root);
    expect(tokenMatches(token, root)).toBe(true);
    expect(tokenMatches(`${token}x`, root)).toBe(false);
    expect(tokenMatches(token.slice(0, -1), root)).toBe(false);
    expect(tokenMatches("", root)).toBe(false);
    expect(tokenMatches(undefined, root)).toBe(false);
  });
});

describe("isLoopbackAddress", () => {
  it("exempts local callers so development needs no token", () => {
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "127.0.0.53"]) {
      expect(isLoopbackAddress(ip), ip).toBe(true);
    }
  });

  it("does not exempt anything else", () => {
    for (const ip of ["203.0.113.9", "10.0.0.4", "::ffff:203.0.113.9", "", undefined]) {
      expect(isLoopbackAddress(ip), String(ip)).toBe(false);
    }
  });
});

describe("installTokenRequired", () => {
  it("cannot be disabled for remote first-run requests", () => {
    expect(installTokenRequired()).toBe(true);
    process.env.JUSTFLOWS_SKIP_INSTALL_TOKEN = "1";
    expect(installTokenRequired()).toBe(true);
  });
});

describe("scripts/install-token.cjs", () => {
  it("mints the same file from root server.js without the Express app", () => {
    const require = createRequire(import.meta.url);
    const candidates = [
      path.resolve(process.cwd(), "../../scripts/install-token.cjs"),
      path.resolve(process.cwd(), "scripts/install-token.cjs"),
    ];
    const file = candidates.find((candidate) => fs.existsSync(candidate));
    if (!file) throw new Error("scripts/install-token.cjs not found");
    const cjs = require(file) as {
      ensureInstallToken: (root: string) => string;
      installTokenFile: (root: string) => string;
    };
    const token = cjs.ensureInstallToken(root);
    expect(fs.readFileSync(cjs.installTokenFile(root), "utf8")).toContain(token);
  });
});
