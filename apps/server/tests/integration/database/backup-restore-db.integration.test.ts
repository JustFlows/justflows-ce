// SPDX-License-Identifier: MIT
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../../../src/lib/database/db.js";
import { runAllMigrations, type DbDriver } from "../../../src/lib/database/run-migrations.js";

/**
 * A full site backup on a real database: every kind of row the backup
 * carries survives export, encryption, and restore into another site on the
 * same driver, with new ids, secrets re-encrypted, and files in place. A
 * failed restore puts the target back as it was.
 *
 *   BACKUP_TEST_DATABASE=1 DB_NAME=backup_test DB_DRIVER=postgres|mysql|mariadb \
 *   pnpm vitest run tests/integration/database/backup-restore-db.integration.test.ts
 */
const enabled = process.env.BACKUP_TEST_DATABASE === "1" && process.env.DB_NAME === "backup_test";
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jf-backup-test-")));
for (const dir of ["uploads", "private", "packages-installed"]) fs.mkdirSync(path.join(scratch, dir), { recursive: true });
process.env.APP_SECRET ||= "integration-test-secret-of-at-least-32-chars";
process.env.STORAGE_LOCAL_PATH = path.join(scratch, "uploads");
process.env.PRIVATE_STORAGE_PATH = path.join(scratch, "private");
process.env.PACKAGES_DIR = path.join(scratch, "packages-installed");
process.env.JF_MULTISITE = "true";

const driver = process.env.DB_DRIVER as DbDriver;
/** JSON columns come back parsed (PostgreSQL, MySQL) or as text (MariaDB). */
const jsonValue = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};
const q = (name: string) => (driver === "postgres" ? `"${name}"` : `\`${name}\``);

describe.skipIf(!enabled)("site backup and restore on a real database", () => {
  const tenantId = randomUUID();
  const source = randomUUID();
  const target = randomUUID();
  const actor = randomUUID();
  const editor = randomUUID();
  const page = randomUUID();
  const parentTerm = randomUUID();
  const childTerm = randomUUID();
  const taxonomy = randomUUID();
  const mediaId = randomUUID();
  const passphrase = "integration passphrase";

  beforeAll(async () => {
    const db = await getDb();
    await runAllMigrations(db, driver);
    const { encryptSecret } = await import("../../../src/lib/security/secret-box.js");
    await db.run("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, ?, 'active')", [tenantId, `t-${tenantId.slice(0, 8)}`, "Backup"]);
    await db.run("INSERT INTO sites (id, tenant_id, name, url) VALUES (?, ?, ?, ?)", [source, tenantId, "Source site", `https://${source}.example`]);
    await db.run("INSERT INTO sites (id, tenant_id, name, url) VALUES (?, ?, ?, ?)", [target, tenantId, "Target site", `https://${target}.example`]);
    await db.run("INSERT INTO users (id, site_id, email, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, 'administrator')", [actor, target, "op@example.com", "op", "Operator", "hash-operator"]);
    await db.run("INSERT INTO users (id, site_id, email, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, 'editor')", [editor, source, "ed@example.com", "ed", "Editor", "hash-editor"]);
    await db.run("INSERT INTO users (id, site_id, email, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, 'administrator')", [randomUUID(), source, "op@example.com", "op-source", "Operator at source", "hash-source"]);
    await db.run(
      "INSERT INTO content (id, site_id, type, title, slug, locale, status, blocks, fields, author_id) VALUES (?, ?, 'page', 'Home', 'home', 'en', 'published', ?, '{}', ?)",
      [page, source, JSON.stringify([{ type: "image", attrs: { mediaId } }]), editor],
    );
    await db.run("INSERT INTO taxonomies (id, site_id, slug, name) VALUES (?, ?, 'topics', 'Topics')", [taxonomy, source]);
    await db.run("INSERT INTO terms (id, site_id, taxonomy_id, slug, name, parent_id) VALUES (?, ?, ?, 'child', 'Child', ?)", [childTerm, source, taxonomy, null]);
    await db.run("INSERT INTO terms (id, site_id, taxonomy_id, slug, name, parent_id) VALUES (?, ?, ?, 'parent', 'Parent', ?)", [parentTerm, source, taxonomy, null]);
    await db.run("UPDATE terms SET parent_id = ? WHERE id = ?", [parentTerm, childTerm]);
    await db.run(`INSERT INTO site_settings (id, site_id, ${q("key")}, value) VALUES (?, ?, 'mail_password', ?)`, [randomUUID(), source, JSON.stringify(encryptSecret("smtp-secret"))]);
    await db.run(
      "INSERT INTO plugin_data (id, site_id, plugin_id, collection, item_id, payload) VALUES (?, ?, 'acme.testplug', 'secrets', 'token', ?)",
      [randomUUID(), source, JSON.stringify(encryptSecret("plugin-token"))],
    );
    await db.run(
      "INSERT INTO plugins (id, site_id, plugin_id, version, status, manifest, approved_permissions) VALUES (?, ?, 'acme.testplug', '1.0.0', 'installed', '{}', '[]')",
      [randomUUID(), source],
    );
    await db.run(
      "INSERT INTO plugins (id, site_id, plugin_id, version, status, manifest, approved_permissions) VALUES (?, ?, 'acme.gone', '1.0.0', 'active', ?, '[]')",
      [randomUUID(), source, JSON.stringify({ bundledPath: path.join(scratch, "no-such-plugins", "gone") })],
    );
    await db.run(
      driver === "postgres"
        ? 'CREATE TABLE IF NOT EXISTS testplug_items (id UUID PRIMARY KEY, site_id UUID NOT NULL, label TEXT, enabled BOOLEAN NOT NULL, created_at TIMESTAMPTZ NOT NULL)'
        : "CREATE TABLE IF NOT EXISTS testplug_items (id CHAR(36) PRIMARY KEY, site_id CHAR(36) NOT NULL, label TEXT, enabled TINYINT(1) NOT NULL, created_at DATETIME(3) NOT NULL)",
    );
    await db.run("INSERT INTO testplug_items (id, site_id, label, enabled, created_at) VALUES (?, ?, ?, ?, ?)", [
      randomUUID(),
      source,
      `refers to ${page}`,
      driver === "postgres" ? true : 1,
      driver === "postgres" ? "2026-11-18T10:20:30.123Z" : "2026-11-18 10:20:30.123",
    ]);
    const { getUploadStore } = await import("../../../src/lib/media/upload-store.js");
    await getUploadStore().put(`${source}/2026/photo.txt`, Buffer.from("photo-bytes"), "text/plain");
    await db.run(
      "INSERT INTO media (id, site_id, filename, mime_type, size_bytes, storage_key, url) VALUES (?, ?, 'photo.txt', 'text/plain', 11, ?, ?)",
      [mediaId, source, `${source}/2026/photo.txt`, `/uploads/${source}/2026/photo.txt`],
    );
    const { localPrivateBackend, objectKey, privateLocalRoot } = await import("../../../src/lib/files/private-storage.js");
    const local = localPrivateBackend(privateLocalRoot());
    await local.put(objectKey(source, "acme.testplug", "downloads/guide.pdf"), Buffer.from("pdf-bytes"), "application/pdf");
    await db.run(
      "INSERT INTO private_files (id, site_id, owner, file_key, size_bytes, content_type, sha256, storage_id) VALUES (?, ?, 'acme.testplug', 'downloads/guide.pdf', 9, 'application/pdf', 'x', ?)",
      [randomUUID(), source, local.id],
    );
    await db.run("INSERT INTO content (id, site_id, type, title, slug, locale, status, blocks, fields) VALUES (?, ?, 'page', 'Old target page', 'old', 'en', 'draft', '[]', '{}')", [randomUUID(), target]);
  }, 180_000);

  async function encryptedBackup(): Promise<Buffer> {
    const { buildSiteBackup } = await import("../../../src/lib/backup/workspace-backup.js");
    const artifact = await buildSiteBackup(source, { passphrase, createdAt: new Date().toISOString(), databaseDriver: driver, coreVersion: "0.4.4" });
    return artifact.archive;
  }

  async function restore(file: Buffer) {
    const { openBackup } = await import("../../../src/lib/backup/archive-crypto.js");
    const { openBackupContainer } = await import("../../../src/lib/backup/backup-container.js");
    const { restoreSingleSite } = await import("../../../src/lib/backup/restore-backup.js");
    const reader = openBackupContainer(openBackup(file, passphrase).plaintext);
    return restoreSingleSite({ targetSiteId: target, installationRoot: false, actorId: actor, reader, plan: {} });
  }

  it("restores every kind of row into another site with new ids and working secrets", async () => {
    const file = await encryptedBackup();
    expect(file.includes(Buffer.from("smtp-secret"))).toBe(false);
    await restore(file);
    const db = await getDb();

    const pages = await db.query<{ id: string; title: string; author_id: string | null; blocks: unknown }>("SELECT id, title, author_id, blocks FROM content WHERE site_id = ? ORDER BY title", [target]);
    expect(pages.map((row) => row.title)).toEqual(["Home"]);
    expect(pages[0]!.id).not.toBe(page);
    const users = await db.query<{ id: string; email: string; password_hash: string }>("SELECT id, email, password_hash FROM users WHERE site_id = ? ORDER BY email", [target]);
    expect(users.map((row) => [row.email, row.password_hash])).toEqual([["ed@example.com", "hash-editor"], ["op@example.com", "hash-operator"]]);
    expect(users.find((row) => row.email === "op@example.com")!.id).toBe(actor);
    expect(pages[0]!.author_id).toBe(users.find((row) => row.email === "ed@example.com")!.id);

    const media = await db.query<{ id: string; storage_key: string }>("SELECT id, storage_key FROM media WHERE site_id = ?", [target]);
    expect(media[0]!.storage_key).toBe(`${target}/2026/photo.txt`);
    expect(String(typeof pages[0]!.blocks === "string" ? pages[0]!.blocks : JSON.stringify(pages[0]!.blocks))).toContain(media[0]!.id);
    const { getUploadStore } = await import("../../../src/lib/media/upload-store.js");
    expect((await getUploadStore().read(`${target}/2026/photo.txt`))?.toString()).toBe("photo-bytes");

    const terms = await db.query<{ id: string; slug: string; parent_id: string | null }>("SELECT id, slug, parent_id FROM terms WHERE site_id = ? ORDER BY slug", [target]);
    expect(terms.find((row) => row.slug === "child")!.parent_id).toBe(terms.find((row) => row.slug === "parent")!.id);

    const { decryptSecret } = await import("../../../src/lib/security/secret-box.js");
    const setting = await db.query<{ value: string }>(`SELECT value FROM site_settings WHERE site_id = ? AND ${q("key")} = 'mail_password'`, [target]);
    expect(decryptSecret(jsonValue(setting[0]!.value))).toBe("smtp-secret");
    const secret = await db.query<{ payload: unknown }>("SELECT payload FROM plugin_data WHERE site_id = ? AND collection = 'secrets'", [target]);
    expect(decryptSecret(jsonValue(secret[0]!.payload))).toBe("plugin-token");

    const items = await db.query<{ label: string; enabled: unknown; created_at: unknown }>("SELECT label, enabled, created_at FROM testplug_items WHERE site_id = ?", [target]);
    expect(items).toHaveLength(1);
    expect(items[0]!.label).toBe(`refers to ${pages[0]!.id}`);
    expect(items[0]!.enabled === true || Number(items[0]!.enabled) === 1).toBe(true);
    expect(new Date(items[0]!.created_at as string).toISOString()).toBe("2026-11-18T10:20:30.123Z");

    const gone = await db.query<{ status: string }>("SELECT status FROM plugins WHERE site_id = ? AND plugin_id = 'acme.gone'", [target]);
    expect(gone[0]!.status).toBe("inactive");

    const { readPrivateFile } = await import("../../../src/lib/files/private-storage.js");
    expect((await readPrivateFile(target, "acme.testplug", "downloads/guide.pdf"))?.toString()).toBe("pdf-bytes");

    const untouched = await db.query<{ title: string }>("SELECT title FROM content WHERE site_id = ?", [source]);
    expect(untouched.map((row) => row.title)).toEqual(["Home"]);
  }, 120_000);

  it("puts the target back when the restore fails part-way", async () => {
    const file = await encryptedBackup();
    const db = await getDb();
    const before = await db.query<{ title: string }>("SELECT title FROM content WHERE site_id = ? ORDER BY title", [target]);
    await db.run(`DROP TABLE ${q("testplug_items")}`);
    await expect(restore(file)).rejects.toThrow(/did not create its table testplug_items.*put back/);
    const after = await db.query<{ title: string }>("SELECT title FROM content WHERE site_id = ? ORDER BY title", [target]);
    expect(after).toEqual(before);
    const users = await db.query<{ id: string }>("SELECT id FROM users WHERE id = ?", [actor]);
    expect(users).toHaveLength(1);
  }, 120_000);
});

describe.skipIf(!enabled)("network backup and restore on a real database", () => {
  const sourceTenant = randomUUID();
  const sourceRoot = randomUUID();
  const sourceSub = randomUUID();
  const targetTenant = randomUUID();
  const targetRoot = randomUUID();
  const operator = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const passphrase = "network integration passphrase";

  beforeAll(async () => {
    const db = await getDb();
    await runAllMigrations(db, driver);
    await db.run("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, ?, 'active')", [sourceTenant, `src-${tag}`, "Source workspace"]);
    await db.run("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, ?, 'active')", [targetTenant, `dst-${tag}`, "Target workspace"]);
    await db.run("INSERT INTO sites (id, tenant_id, name, url, status) VALUES (?, ?, 'Source root', ?, 'active')", [sourceRoot, sourceTenant, `https://root-${tag}.example`]);
    await db.run("INSERT INTO sites (id, tenant_id, name, url, status) VALUES (?, ?, 'Source sub', ?, 'active')", [sourceSub, sourceTenant, `https://sub-${tag}.example`]);
    await db.run("INSERT INTO sites (id, tenant_id, name, url, status) VALUES (?, ?, 'Clean root', ?, 'active')", [targetRoot, targetTenant, `https://clean-${tag}.example`]);
    for (const [site, host, primary] of [[sourceRoot, `root-${tag}.example`, true], [sourceSub, `sub-${tag}.example`, true], [targetRoot, `clean-${tag}.example`, true]] as const) {
      await db.run("INSERT INTO site_domains (id, site_id, hostname, kind, verified, is_primary) VALUES (?, ?, ?, 'primary', ?, ?)", [randomUUID(), site, host, true, primary]);
    }
    await db.run("INSERT INTO users (id, site_id, email, username, display_name, password_hash, role) VALUES (?, ?, 'owner@example.com', ?, 'Owner', 'hash-owner', 'administrator')", [randomUUID(), sourceRoot, `owner-${tag}`]);
    await db.run("INSERT INTO users (id, site_id, email, username, display_name, password_hash, role) VALUES (?, ?, 'writer@example.com', ?, 'Writer', 'hash-writer', 'editor')", [randomUUID(), sourceSub, `writer-${tag}`]);
    await db.run("INSERT INTO users (id, site_id, email, username, display_name, password_hash, role) VALUES (?, ?, 'op@example.com', ?, 'Operator', 'hash-op', 'administrator')", [operator, targetRoot, `op-${tag}`]);
    await db.run("INSERT INTO content (id, site_id, type, title, slug, status, blocks, fields) VALUES (?, ?, 'page', 'Root home', 'home', 'published', '[]', '{}')", [randomUUID(), sourceRoot]);
    await db.run("INSERT INTO content (id, site_id, type, title, slug, status, blocks, fields) VALUES (?, ?, 'page', 'Sub home', 'home', 'published', '[]', '{}')", [randomUUID(), sourceSub]);
  }, 180_000);

  /** Last suite in the file: close the shared pool and remove the scratch folders. */
  afterAll(async () => {
    await (await getDb()).close().catch(() => undefined);
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it("rebuilds the root and every subsite on a clean workspace at the reviewed address", async () => {
    const { buildNetworkBackup } = await import("../../../src/lib/backup/workspace-backup.js");
    const { openBackup } = await import("../../../src/lib/backup/archive-crypto.js");
    const { openBackupContainer } = await import("../../../src/lib/backup/backup-container.js");
    const { restoreNetwork } = await import("../../../src/lib/backup/restore-backup.js");
    const artifact = await buildNetworkBackup(sourceRoot, { passphrase, createdAt: new Date().toISOString(), databaseDriver: driver, coreVersion: "0.4.4" });
    const reader = openBackupContainer(openBackup(artifact.archive, passphrase).plaintext);
    expect(reader.manifest.sites.map((entry) => entry.siteId)).toEqual([sourceRoot, sourceSub]);

    const result = await restoreNetwork({
      rootSiteId: targetRoot,
      actorId: operator,
      reader,
      plan: { hostnames: { [sourceSub]: [{ hostname: `restored-${tag}.example`, primary: true }] } },
    });
    const db = await getDb();
    const created = result.sites.find((item) => item.sourceSiteId === sourceSub)!;
    const site = await db.query<{ tenant_id: string; status: string; name: string }>("SELECT tenant_id, status, name FROM sites WHERE id = ?", [created.siteId]);
    expect(site[0]).toMatchObject({ tenant_id: targetTenant, status: "active", name: "Source sub" });
    const domains = await db.query<{ hostname: string }>("SELECT hostname FROM site_domains WHERE site_id = ?", [created.siteId]);
    expect(domains.map((row) => row.hostname)).toEqual([`restored-${tag}.example`]);
    expect((await db.query<{ title: string }>("SELECT title FROM content WHERE site_id = ?", [created.siteId])).map((row) => row.title)).toEqual(["Sub home"]);
    expect((await db.query<{ title: string }>("SELECT title FROM content WHERE site_id = ?", [targetRoot])).map((row) => row.title)).toEqual(["Root home"]);
    const subUsers = await db.query<{ email: string; password_hash: string }>("SELECT email, password_hash FROM users WHERE site_id = ? ORDER BY email", [created.siteId]);
    expect(subUsers.map((row) => row.email)).toEqual(["op@example.com", "writer@example.com"]);
    expect(subUsers.find((row) => row.email === "writer@example.com")!.password_hash).toBe("hash-writer");
    const rootUsers = await db.query<{ id: string; email: string }>("SELECT id, email FROM users WHERE site_id = ? ORDER BY email", [targetRoot]);
    expect(rootUsers.map((row) => row.email)).toEqual(["op@example.com", "owner@example.com"]);
    expect(rootUsers.find((row) => row.email === "op@example.com")!.id).toBe(operator);
    const tenant = await db.query<{ name: string }>("SELECT name FROM tenants WHERE id = ?", [targetTenant]);
    expect(tenant[0]!.name).toBe("Source workspace");
  }, 180_000);
});
