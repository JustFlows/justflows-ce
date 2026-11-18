// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPortableBackup } from "../../../src/lib/backup/portable-archive.js";
import { CONTAINER_MAGIC, createBackupContainer, openBackupContainer } from "../../../src/lib/backup/backup-container.js";

function site(siteId: string, title: string): Buffer {
  return createPortableBackup({
    createdAt: "2026-11-18T10:00:00.000Z",
    source: { siteId, siteName: siteId, databaseDriver: "postgres" },
    data: {
      site: { id: siteId, name: siteId },
      tables: { content: [{ id: `${siteId}-home`, title }] },
      quotaLimits: [],
      pluginTables: [],
      packages: [],
      files: [],
      privateFiles: [],
      themeFiles: [],
      database: null,
      undecryptableSecrets: 0,
      extensions: { plugins: [], themes: [] },
    },
  });
}

const pkg = Buffer.from("package bytes");
const digest = createHash("sha256").update(pkg).digest("hex");
const meta = { digest, type: "plugin" as const, id: "justflows.forms", version: "0.5.0", source: "marketplace" as const, signature: "sig" };

function network(): Buffer {
  return createBackupContainer({
    kind: "network",
    createdAt: "2026-11-18T10:00:00.000Z",
    databaseDriver: "postgres",
    installation: { tenant: { name: "Primary", slug: "primary", userMode: "isolated" }, platformSettings: [], platformOperators: [] },
    sites: [
      { siteId: "root", siteName: "Root", root: true, hostnames: [{ hostname: "example.test", primary: true, kind: "primary" }], archive: site("root", "Root home"), extensions: { plugins: [{ plugin_id: "justflows.forms", version: "0.5.0" }], themes: [] } },
      { siteId: "child", siteName: "Child", root: false, hostnames: [], archive: site("child", "Child home"), extensions: { plugins: [{ plugin_id: "justflows.forms", version: "0.5.0" }], themes: [] } },
    ],
    packages: [
      { meta, buffer: pkg },
      { meta, buffer: pkg },
    ],
  });
}

describe("backup container", () => {
  it("round-trips sites, the installation section, and each package once", () => {
    const reader = openBackupContainer(network());
    expect(reader.manifest.sites.map((entry) => [entry.siteId, entry.root])).toEqual([["root", true], ["child", false]]);
    expect(reader.manifest.packages).toHaveLength(1);
    expect(reader.packageBytes(digest).toString()).toBe("package bytes");
    expect(reader.manifest.installation?.tenant.slug).toBe("primary");
    expect(reader.manifest.extensions.plugins).toEqual([{ id: "justflows.forms", version: "0.5.0", sites: ["root", "child"] }]);
    expect(reader.readSite(reader.manifest.sites[1]!).data.tables.content?.[0]?.title).toBe("Child home");
  });

  it("rejects changed bytes, a truncated file, and extra data", () => {
    const archive = network();
    const changed = Buffer.from(archive);
    changed[changed.byteLength - 3] = changed[changed.byteLength - 3]! ^ 1;
    expect(() => openBackupContainer(changed)).toThrow(/integrity|digest/);
    expect(() => openBackupContainer(archive.subarray(0, archive.byteLength - 1))).toThrow(/truncated/);
    expect(() => openBackupContainer(Buffer.concat([archive, Buffer.from("x")]))).toThrow(/truncated/);
  });

  it("rejects an edited manifest", () => {
    const archive = network();
    const length = archive.readUInt32BE(8);
    const text = archive.subarray(12, 12 + length).toString("utf8").replace('"slug":"primary"', '"slug":"evil123"');
    const edited = Buffer.concat([CONTAINER_MAGIC, archive.subarray(8, 12), Buffer.from(text), archive.subarray(12 + length)]);
    expect(() => openBackupContainer(edited)).toThrow(/integrity/);
  });

  it("holds exactly one site in a site backup", () => {
    expect(() =>
      createBackupContainer({
        kind: "site",
        createdAt: "2026-11-18T10:00:00.000Z",
        databaseDriver: "mysql",
        installation: null,
        sites: [
          { siteId: "a", siteName: "A", root: false, hostnames: [], archive: site("a", "A") },
          { siteId: "b", siteName: "B", root: false, hostnames: [], archive: site("b", "B") },
        ],
        packages: [],
      }),
    ).toThrow(/exactly one site/);
  });
});
