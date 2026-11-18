// SPDX-License-Identifier: MIT

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  decodeJsonValue,
  EXCLUDED_SITE_TABLES,
  exportSecrets,
  IdMap,
  importSecrets,
  importValue,
  SITE_TABLES,
} from "../../../src/lib/backup/site-tables.js";
import { decryptSecret, encryptSecret } from "../../../src/lib/security/secret-box.js";

const migrationsDir = fileURLToPath(new URL("../../../../../migrations", import.meta.url));

/** Every table the PostgreSQL migrations create, with its columns' text and the tables it references. */
function schema(): Map<string, { siteScoped: boolean; references: Set<string> }> {
  const tables = new Map<string, { siteScoped: boolean; references: Set<string> }>();
  for (const file of fs.readdirSync(migrationsDir).sort()) {
    if (!file.endsWith(".sql") || file.endsWith(".mysql.sql") || file.endsWith(".mariadb.sql")) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    for (const match of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?([a-z_]+)"?\s*\(([\s\S]*?)\n\);/g)) {
      const name = match[1]!;
      const body = match[2]!;
      const entry = tables.get(name) ?? { siteScoped: false, references: new Set<string>() };
      if (/\bsite_id\b/.test(body)) entry.siteScoped = true;
      for (const ref of body.matchAll(/REFERENCES\s+"?([a-z_]+)/g)) if (ref[1] !== name) entry.references.add(ref[1]!);
      tables.set(name, entry);
    }
    for (const match of sql.matchAll(/ALTER TABLE "?([a-z_]+)"? ADD COLUMN (?:IF NOT EXISTS )?site_id/g)) {
      const entry = tables.get(match[1]!);
      if (entry) entry.siteScoped = true;
    }
  }
  return tables;
}

describe("backup table coverage", () => {
  it("classifies every site-scoped table as backed up or deliberately excluded", () => {
    const covered = new Set<string>([...SITE_TABLES, ...Object.keys(EXCLUDED_SITE_TABLES), "content_terms", "user_preferences"]);
    const missing = [...schema()].filter(([name, info]) => info.siteScoped && !covered.has(name)).map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it("lists parents before the tables that reference them", () => {
    const tables = schema();
    const order = new Map<string, number>(SITE_TABLES.map((name, index) => [name, index]));
    for (const name of SITE_TABLES) {
      for (const ref of tables.get(name)?.references ?? []) {
        if (order.has(ref)) expect(order.get(ref)!, `${ref} before ${name}`).toBeLessThan(order.get(name)!);
      }
    }
  });
});

describe("secret transport", () => {
  beforeAll(() => {
    process.env.APP_SECRET = "a".repeat(40);
  });

  it("decrypts stored secrets into markers and re-encrypts them with the target key", () => {
    const stored = encryptSecret("smtp-password");
    const row = { key: "mail", value: JSON.stringify({ host: "smtp.test", password: stored }) };
    const stats = { undecryptable: 0 };
    const portable = exportSecrets(row, stats) as typeof row;
    expect(portable.value).not.toContain("enc:v1:");
    expect(portable.value).toContain("jfsecret:v1:");

    process.env.APP_SECRET = "b".repeat(40);
    const restored = importSecrets(portable) as typeof row;
    const password = (JSON.parse(restored.value) as { password: string }).password;
    expect(password.startsWith("enc:v1:")).toBe(true);
    expect(decryptSecret(password)).toBe("smtp-password");
    expect(stats.undecryptable).toBe(0);
  });
});

describe("identifier remapping", () => {
  it("rewrites ids in columns, JSON blocks, and storage paths", () => {
    const ids = new IdMap();
    const site = "11111111-1111-4111-8111-111111111111";
    const media = "22222222-2222-4222-8222-222222222222";
    ids.set(site, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    ids.assignRowIds([{ id: media }], () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    const row = ids.apply({
      id: media,
      storage_key: `${site}/2026/photo.jpg`,
      blocks: JSON.stringify([{ type: "image", attrs: { mediaId: media.toUpperCase() } }]),
      untouched: "33333333-3333-4333-8333-333333333333",
    }) as Record<string, string>;
    expect(row.id).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(row.storage_key).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026/photo.jpg");
    expect(row.blocks).toContain("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(row.untouched).toBe("33333333-3333-4333-8333-333333333333");
  });
});

describe("value conversion between databases", () => {
  const bool = { name: "active", type: "boolean", columnType: "boolean", json: false };
  const tinyint = { name: "active", type: "tinyint", columnType: "tinyint(1)", json: false };
  const timestamp = { name: "created_at", type: "timestamp with time zone", columnType: "timestamptz", json: false };
  const datetime = { name: "created_at", type: "datetime", columnType: "datetime(3)", json: false };

  it("turns MySQL 0/1 into PostgreSQL booleans and back", () => {
    expect(importValue(1, bool, "postgres")).toBe(true);
    expect(importValue(0, bool, "postgres")).toBe(false);
    expect(importValue(true, tinyint, "mysql")).toBe(1);
  });

  it("writes ISO times as MySQL datetime literals and keeps them for PostgreSQL", () => {
    expect(importValue("2026-11-18T10:20:30.123Z", datetime, "mariadb")).toBe("2026-11-18 10:20:30.123");
    expect(importValue("2026-11-18T10:20:30.123Z", timestamp, "postgres")).toBe("2026-11-18T10:20:30.123Z");
  });

  it("writes JSON columns the way the app does, on every driver", () => {
    const json = { name: "value", type: "jsonb", columnType: "jsonb", json: true };
    expect(importValue({ a: 1 }, json, "postgres")).toBe('{"a":1}');
    expect(importValue("enc:v1:x", { ...json, type: "longtext" }, "mariadb")).toBe('"enc:v1:x"');
  });

  it("reads JSON columns the way the app does, whichever form the driver returns", () => {
    expect(decodeJsonValue('"enc:v1:x"')).toBe("enc:v1:x");
    expect(decodeJsonValue("enc:v1:x")).toBe("enc:v1:x");
    expect(decodeJsonValue({ a: 1 })).toEqual({ a: 1 });
  });
});
