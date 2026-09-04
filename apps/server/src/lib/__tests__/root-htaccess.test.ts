// SPDX-License-Identifier: MIT

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MANAGED_SENTINEL } from "../managed-config.js";
import { ROOT_HTACCESS_FILE, renderRootHtaccess, writeRootHtaccess } from "../root-htaccess.js";

describe("renderRootHtaccess", () => {
  const out = renderRootHtaccess();

  it("starts with the shared managed sentinel", () => {
    expect(out.startsWith(MANAGED_SENTINEL)).toBe(true);
  });

  it("blocks the app's own directories and files", () => {
    expect(out).toMatch(/RewriteRule \^\(\?:apps\|packages\|scripts\|node_modules\|data\|/);
    expect(out).toContain("server\\.js");
    expect(out).toContain("package(?:-lock)?\\.json");
  });

  it("denies dotfiles and source/config extensions but keeps robots/sitemap public", () => {
    expect(out).toMatch(/<FilesMatch "\^\\\.\|.*\benv\b.*">\n {2}Require all denied/);
    expect(out).toContain("robots\\.txt|sitemap\\.xml|favicon\\.ico");
    expect(out).toMatch(/Require all granted/);
  });

  it("sets baseline security headers and no directory listing", () => {
    expect(out).toContain('Header always set X-Content-Type-Options "nosniff"');
    expect(out).toContain('Header always set X-Frame-Options "SAMEORIGIN"');
    expect(out).toContain("Options -Indexes");
  });

  it("leaves the reverse-proxy hand-off commented (host-specific)", () => {
    expect(out).toMatch(/^\s*# RewriteRule \^ http:\/\/127\.0\.0\.1:3000/m);
  });
});

describe("writeRootHtaccess", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jf-root-ht-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes when absent, then reports unchanged", async () => {
    expect(await writeRootHtaccess(dir)).toBe("written");
    expect(await readFile(path.join(dir, ROOT_HTACCESS_FILE), "utf8")).toBe(renderRootHtaccess());
    expect(await writeRootHtaccess(dir)).toBe("unchanged");
  });

  it("refreshes a stale managed file", async () => {
    await writeFile(
      path.join(dir, ROOT_HTACCESS_FILE),
      `${MANAGED_SENTINEL} — site-root hardening.\n# old\n`,
    );
    expect(await writeRootHtaccess(dir)).toBe("written");
    expect(await readFile(path.join(dir, ROOT_HTACCESS_FILE), "utf8")).toBe(renderRootHtaccess());
  });

  it("never clobbers a hand-rolled .htaccess", async () => {
    const custom = "RewriteEngine On\nRewriteRule ^ /index.php [L]\n";
    await writeFile(path.join(dir, ROOT_HTACCESS_FILE), custom);
    expect(await writeRootHtaccess(dir)).toBe("kept-custom");
    expect(await readFile(path.join(dir, ROOT_HTACCESS_FILE), "utf8")).toBe(custom);
  });
});
