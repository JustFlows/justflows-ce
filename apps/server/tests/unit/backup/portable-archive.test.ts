// SPDX-License-Identifier: MIT

import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPortableBackup, readPortableBackup } from "../../../src/lib/backup/portable-archive.js";

const input = {
  createdAt: "2026-11-04T10:00:00.000Z",
  source: { siteId: "site-1", siteName: "Example", databaseDriver: "postgres" as const },
  data: {
    tables: { content: [{ id: "page-1", title: "Home" }] },
    extensions: { plugins: [], themes: [] },
    files: [{ key: "site-1/image.txt", mimeType: "text/plain", size: 5, sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", data: "aGVsbG8=" }],
  },
};

describe("portable backup archive", () => {
  it("round-trips a versioned archive with a SHA-256 integrity manifest", () => {
    const decoded = readPortableBackup(createPortableBackup(input));
    expect(decoded.source).toEqual(input.source);
    expect(decoded.data).toEqual(input.data);
    expect(decoded.integrity.data).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects changed data even when the envelope remains valid JSON", () => {
    const envelope = JSON.parse(gunzipSync(createPortableBackup(input)).toString("utf8"));
    envelope.data.tables.content[0].title = "Changed";
    expect(() => readPortableBackup(gzipSync(JSON.stringify(envelope)))).toThrow("integrity check failed");
    envelope.data.tables.content[0].title = "Home";
    envelope.source.siteId = "other-site";
    expect(() => readPortableBackup(gzipSync(JSON.stringify(envelope)))).toThrow("integrity check failed");
  });

  it("verifies every embedded media file independently", () => {
    const envelope = JSON.parse(gunzipSync(createPortableBackup(input)).toString("utf8"));
    envelope.data.files[0].sha256 = "0".repeat(64);
    const payload = { createdAt: envelope.createdAt, source: envelope.source, data: envelope.data };
    envelope.integrity.data = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    expect(() => readPortableBackup(gzipSync(JSON.stringify(envelope)))).toThrow("media integrity check failed");
  });

  it("rejects unknown and malformed archives", () => {
    expect(() => readPortableBackup(Buffer.from("not an archive"))).toThrow("not valid compressed JSON");
    expect(() => readPortableBackup(gzipSync(JSON.stringify({ format: "other", version: 1 })))).toThrow("not supported");
  });
});
