// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { createPortableBackup } from "../../../src/lib/backup/portable-archive.js";
import {
  createNetworkBackup,
  isNetworkBackup,
  NETWORK_BACKUP_MAGIC,
  openNetworkBackup,
} from "../../../src/lib/backup/network-archive.js";

function siteArchive(siteId: string, title: string): Buffer {
  return createPortableBackup({
    createdAt: "2026-11-18T10:00:00.000Z",
    source: { siteId, siteName: siteId, databaseDriver: "postgres" },
    data: {
      tables: { content: [{ id: `${siteId}-home`, title }] },
      extensions: { plugins: [], themes: [] },
      files: [],
    },
  });
}

const sharedPlugin = { plugin_id: "justflows.forms", version: "0.5.0", status: "active" };

function network(): Buffer {
  return createNetworkBackup({
    createdAt: "2026-11-18T10:00:00.000Z",
    databaseDriver: "postgres",
    coreVersion: "0.4.4",
    sites: [
      {
        siteId: "root",
        siteName: "Root",
        root: true,
        hostnames: [{ hostname: "example.com", primary: true }],
        archive: siteArchive("root", "Root home"),
        extensions: { plugins: [sharedPlugin], themes: [] },
      },
      {
        siteId: "child",
        siteName: "Child",
        root: false,
        hostnames: [{ hostname: "child.example.com", primary: true }],
        archive: siteArchive("child", "Child home"),
        extensions: { plugins: [sharedPlugin], themes: [{ theme_id: "zine", version: "1.0.0" }] },
      },
    ],
  });
}

describe("network backup archive", () => {
  it("round-trips the site hierarchy and each site's own archive", () => {
    const archive = network();
    expect(isNetworkBackup(archive)).toBe(true);
    const reader = openNetworkBackup(archive);
    expect(reader.manifest.sites.map((site) => [site.siteId, site.root])).toEqual([
      ["root", true],
      ["child", false],
    ]);
    expect(reader.manifest.source.rootSiteId).toBe("root");
    expect(reader.readSite(reader.manifest.sites[1]!).data.tables.content?.[0]?.title).toBe(
      "Child home",
    );
  });

  it("lists a package shared by several sites once, with the sites that use it", () => {
    const { manifest } = openNetworkBackup(network());
    expect(manifest.extensions.plugins).toEqual([
      { id: "justflows.forms", version: "0.5.0", sites: ["root", "child"] },
    ]);
    expect(manifest.extensions.themes).toEqual([{ id: "zine", version: "1.0.0", sites: ["child"] }]);
  });

  it("rejects a changed site archive", () => {
    const archive = network();
    const index = archive.byteLength - 5;
    archive[index] = archive[index]! ^ 0xff;
    expect(() => openNetworkBackup(archive)).toThrow(/integrity check failed/);
  });

  it("rejects a manifest edited to point at another hostname", () => {
    const archive = network();
    const length = archive.readUInt32BE(NETWORK_BACKUP_MAGIC.byteLength);
    const start = NETWORK_BACKUP_MAGIC.byteLength + 4;
    const text = archive.subarray(start, start + length).toString("utf8");
    const edited = Buffer.from(text.replace("child.example.com", "evil.example.com"));
    expect(edited.byteLength).toBe(length - 1);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(edited.byteLength, 0);
    const tampered = Buffer.concat([
      NETWORK_BACKUP_MAGIC,
      header,
      edited,
      archive.subarray(start + length),
    ]);
    expect(() => openNetworkBackup(tampered)).toThrow(/integrity check failed/);
  });

  it("rejects truncated archives and trailing bytes", () => {
    const archive = network();
    expect(() => openNetworkBackup(archive.subarray(0, archive.byteLength - 1))).toThrow(
      /truncated/,
    );
    expect(() => openNetworkBackup(Buffer.concat([archive, Buffer.from("x")]))).toThrow(
      /truncated/,
    );
  });

  it("rejects a manifest length beyond the archive", () => {
    const archive = Buffer.from(network());
    archive.writeUInt32BE(0xffffffff, NETWORK_BACKUP_MAGIC.byteLength);
    expect(() => openNetworkBackup(archive)).toThrow(/manifest is invalid/);
  });

  it("refuses to build without the root site first", () => {
    expect(() =>
      createNetworkBackup({
        createdAt: "2026-11-18T10:00:00.000Z",
        databaseDriver: "mysql",
        sites: [
          {
            siteId: "child",
            siteName: "Child",
            root: false,
            hostnames: [],
            archive: siteArchive("child", "Child"),
          },
        ],
      }),
    ).toThrow(/root site first/);
  });

  it("does not treat a single-site archive as a network archive", () => {
    expect(isNetworkBackup(siteArchive("root", "Root"))).toBe(false);
    expect(() => openNetworkBackup(siteArchive("root", "Root"))).toThrow(/not a network backup/);
  });
});
