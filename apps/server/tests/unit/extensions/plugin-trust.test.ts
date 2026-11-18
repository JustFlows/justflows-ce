// SPDX-License-Identifier: MIT

import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Plugin trust states (justflows-ce#270): signed attestations bound to one
 * archive digest, fail closed, legacy grace, operator trust, and the marker
 * that tells a pre-trust row from a package written since.
 */
const rows = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock("../../../src/lib/database/db.js", () => ({
  getDb: async () => ({
    query: async (sql: string, params: unknown[]) => {
      if (sql.startsWith("SELECT * FROM plugins WHERE site_id = ? AND plugin_id = ?")) {
        const row = rows.get(`${params[0]}:${params[1]}`);
        return row ? [{ ...row }] : [];
      }
      return [];
    },
    run: async (sql: string, params: unknown[]) => {
      if (sql.startsWith("UPDATE plugins SET version = ?, manifest = ?")) {
        const key = `${params[3]}:${params[4]}`;
        rows.set(key, { ...rows.get(key), version: params[0], manifest: params[1] });
      } else if (sql.includes("INSERT INTO plugins")) {
        rows.set(`${params[1]}:${params[2]}`, { id: params[0], site_id: params[1], plugin_id: params[2], version: params[3], status: params[4], manifest: params[5], approved_permissions: "[]", safe_mode: false });
      }
    },
  }),
}));
vi.mock("../../../src/lib/plugins/plugin-network.js", () => ({ clearMainSitePluginCache: () => undefined }));
vi.mock("../../../src/lib/plugins/plugin-root-manifest.js", () => ({ clearRootPluginCache: () => undefined }));

const trust = await import("../../../src/lib/extensions/plugin-trust.js");
const { insertPlugin, mergeLoadedPluginManifest } = await import("../../../src/lib/plugins/plugins-db.js");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const KEYS = [publicKey.export({ type: "spki", format: "pem" }).toString()];
const DIGEST = "a".repeat(64);
const NOW = new Date("2026-11-18T12:00:00.000Z");

function envelope(feed: Record<string, unknown>, signWith = privateKey, prefix?: (payload: string) => Buffer) {
  const payload = JSON.stringify(feed);
  return { payload, signature: sign(null, (prefix ?? trust.attestationSignPayload)(payload), signWith).toString("base64") };
}

const attestation = { type: "plugin", packageId: "acme.forms", version: "1.2.0", archiveDigest: DIGEST, review: "extension-review-1", issuedAt: "2026-11-01T00:00:00.000Z" };
const feed = (extra: Record<string, unknown> = {}) => ({ sequence: 3, issuedAt: "2026-11-17T00:00:00.000Z", expiresAt: "2026-12-17T00:00:00.000Z", attestations: [attestation], ...extra });

describe("attestation feed", () => {
  it("accepts an authentic, current feed", () => {
    const state = trust.readAttestationEnvelope(envelope(feed()), NOW, KEYS);
    expect(state.state).toBe("current");
  });

  it("refuses a tampered payload, another key, an advisory signature, and a malformed entry", () => {
    const good = envelope(feed());
    expect(trust.readAttestationEnvelope({ ...good, payload: good.payload.replace("1.2.0", "1.3.0") }, NOW, KEYS).state).toBe("unavailable");
    expect(trust.readAttestationEnvelope(envelope(feed(), generateKeyPairSync("ed25519").privateKey), NOW, KEYS).state).toBe("unavailable");
    const advisoryStyle = (payload: string) => Buffer.from(`justflows-advisories\n${createHash("sha256").update(payload).digest("hex")}`);
    expect(trust.readAttestationEnvelope(envelope(feed(), privateKey, advisoryStyle), NOW, KEYS).state).toBe("unavailable");
    expect(trust.readAttestationEnvelope(envelope(feed({ attestations: [{ ...attestation, archiveDigest: "not-a-digest" }] })), NOW, KEYS).state).toBe("unavailable");
    expect(trust.readAttestationEnvelope(null, NOW, KEYS).state).toBe("unavailable");
  });

  it("reports an expired feed and never stores it, or an older sequence", () => {
    const expired = envelope(feed({ expiresAt: "2026-11-01T00:00:00.000Z" }));
    expect(trust.readAttestationEnvelope(expired, NOW, KEYS).state).toBe("expired");
    expect(trust.shouldStoreAttestationEnvelope(expired, null, NOW, KEYS)).toBe(false);
    const stored = envelope(feed({ sequence: 5 }));
    expect(trust.shouldStoreAttestationEnvelope(envelope(feed({ sequence: 4 })), stored, NOW, KEYS)).toBe(false);
    expect(trust.shouldStoreAttestationEnvelope(envelope(feed({ sequence: 6 })), stored, NOW, KEYS)).toBe(true);
  });
});

describe("resolvePluginTrust", () => {
  const current = trust.readAttestationEnvelope(envelope(feed()), NOW, KEYS);
  const policy = { legacySince: "2026-11-01T00:00:00.000Z", operatorTrusted: [] as Array<{ packageId: string; archiveDigest: string; trustedAt: string; trustedBy: string }> };
  const plugin = { pluginId: "acme.forms", version: "1.2.0", archiveDigest: DIGEST, recordedSinceTrust: true };
  const resolve = (overrides: Partial<Parameters<typeof trust.resolvePluginTrust>[0]> = {}) =>
    trust.resolvePluginTrust({ plugin, attestations: current, revoked: false, policy, operatorTrustAllowed: true, now: NOW, ...overrides });

  it("verifies only the exact id, version, and digest", () => {
    expect(resolve()).toMatchObject({ state: "verified", reason: "attested", review: "extension-review-1" });
    expect(resolve({ plugin: { ...plugin, version: "1.2.1" } })).toMatchObject({ state: "unverified", reason: "noAttestation" });
    expect(resolve({ plugin: { ...plugin, archiveDigest: "b".repeat(64) } })).toMatchObject({ state: "unverified" });
    expect(resolve({ plugin: { ...plugin, archiveDigest: null } })).toMatchObject({ state: "unverified", reason: "noDigest" });
  });

  it("fails closed without a current feed, and a revocation wins over everything", () => {
    expect(resolve({ attestations: { state: "unavailable" } })).toMatchObject({ state: "unverified", reason: "attestationsUnavailable" });
    if (current.state === "unavailable") throw new Error("fixture feed did not verify");
    expect(resolve({ attestations: { state: "expired", feed: current.feed } })).toMatchObject({ state: "unverified" });
    const operator = { ...policy, operatorTrusted: [{ packageId: "acme.forms", archiveDigest: DIGEST, trustedAt: "x", trustedBy: "y" }] };
    expect(resolve({ revoked: true, policy: operator })).toMatchObject({ state: "unverified", reason: "revoked" });
  });

  it("honours operator trust for that digest only, and never on a multisite network", () => {
    const other = { ...plugin, pluginId: "own.plugin" };
    const operator = { ...policy, operatorTrusted: [{ packageId: "own.plugin", archiveDigest: DIGEST, trustedAt: "2026-11-02", trustedBy: "admin@example.com" }] };
    expect(resolve({ plugin: other, policy: operator })).toMatchObject({ state: "operator", reason: "operatorTrusted" });
    expect(resolve({ plugin: { ...other, archiveDigest: "c".repeat(64) }, policy: operator })).toMatchObject({ state: "unverified" });
    expect(resolve({ plugin: other, policy: operator, operatorTrustAllowed: false })).toMatchObject({ state: "unverified" });
  });

  it("gives legacy trust only to rows from before trust states, until the deadline", () => {
    const legacy = { ...plugin, pluginId: "old.plugin", recordedSinceTrust: false };
    expect(resolve({ plugin: legacy })).toMatchObject({ state: "legacy", legacyUntil: "2027-01-30T00:00:00.000Z" });
    expect(resolve({ plugin: legacy, now: new Date("2027-02-01T00:00:00.000Z") })).toMatchObject({ state: "unverified", reason: "legacyExpired" });
    expect(resolve({ plugin: { ...legacy, recordedSinceTrust: true } })).toMatchObject({ state: "unverified" });
    expect(resolve({ plugin: legacy, policy: { ...policy, legacySince: null } })).toMatchObject({ state: "unverified" });
  });
});

describe("the package marker on plugin rows", () => {
  beforeEach(() => rows.clear());
  const marker = (siteId: string, pluginId: string) => JSON.parse(String(rows.get(`${siteId}:${pluginId}`)!.manifest))[trust.PACKAGE_RECORDED_AT_KEY];

  it("stamps every install and update, whatever the package manifest says", async () => {
    await insertPlugin("s1", { pluginId: "acme.forms", version: "1.0.0", manifest: { id: "acme.forms" } });
    expect(typeof marker("s1", "acme.forms")).toBe("string");
    rows.set("s1:legacy", { id: "r", site_id: "s1", plugin_id: "legacy", version: "1.0.0", status: "active", manifest: JSON.stringify({ id: "legacy" }), approved_permissions: "[]" });
    await insertPlugin("s1", { pluginId: "legacy", version: "1.1.0", manifest: { id: "legacy", [trust.PACKAGE_RECORDED_AT_KEY]: undefined } });
    expect(typeof marker("s1", "legacy")).toBe("string");
  });

  it("keeps the source row's marker, present or absent, on a subsite copy", async () => {
    await insertPlugin("s2", { pluginId: "old", version: "1.0.0", manifest: { id: "old" }, copyOfInstalledRow: true });
    expect(marker("s2", "old")).toBeUndefined();
  });

  it("does not let the loaded module set or clear the marker", async () => {
    rows.set("s1:legacy", { id: "r", site_id: "s1", plugin_id: "legacy", version: "1.0.0", status: "active", manifest: JSON.stringify({ id: "legacy" }), approved_permissions: "[]" });
    await mergeLoadedPluginManifest("s1", "legacy", { version: "1.0.0", [trust.PACKAGE_RECORDED_AT_KEY]: "2026-11-18" });
    expect(marker("s1", "legacy")).toBeUndefined();
    await insertPlugin("s1", { pluginId: "fresh", version: "1.0.0", manifest: { id: "fresh" } });
    await mergeLoadedPluginManifest("s1", "fresh", { version: "1.0.0", [trust.PACKAGE_RECORDED_AT_KEY]: null });
    expect(typeof marker("s1", "fresh")).toBe("string");
  });
});
