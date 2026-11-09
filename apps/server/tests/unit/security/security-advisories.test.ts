// SPDX-License-Identifier: MIT

import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  advisorySignPayload,
  matchAdvisories,
  readAdvisoryEnvelope,
  shouldStoreEnvelope,
  type Advisory,
  type AdvisoryFeed,
} from "../../../src/lib/security/security-advisories.js";
import { coreReleaseSignPayload } from "../../../src/lib/extensions/package-trust.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const keys = [publicKey.export({ type: "spki", format: "pem" }).toString()];
const now = new Date("2026-11-05T00:00:00.000Z");

const advisory: Advisory = {
  id: "JF-2026-001",
  severity: "high",
  title: "Example",
  url: "https://justflows.com/security/jf-2026-001",
  type: "plugin",
  packageId: "acme.forms",
  ranges: [{ introduced: "1.0.0", fixed: "1.2.0" }],
  revoked: false,
};

function feed(overrides: Partial<AdvisoryFeed> = {}): AdvisoryFeed {
  return {
    sequence: 5,
    issuedAt: "2026-11-01T00:00:00.000Z",
    expiresAt: "2026-12-01T00:00:00.000Z",
    advisories: [advisory],
    ...overrides,
  };
}

function envelope(value: unknown, key = privateKey) {
  const payload = JSON.stringify(value);
  return { payload, signature: sign(null, advisorySignPayload(payload), key).toString("base64") };
}

describe("readAdvisoryEnvelope", () => {
  it("accepts a signed, current feed", () => {
    const result = readAdvisoryEnvelope(envelope(feed()), now, keys);
    expect(result).toMatchObject({ state: "current", feed: { sequence: 5 } });
  });

  it("marks a signed feed past its expiry as expired", () => {
    const old = envelope(feed({ expiresAt: "2026-11-04T00:00:00.000Z" }));
    expect(readAdvisoryEnvelope(old, now, keys).state).toBe("expired");
  });

  it("rejects a changed payload", () => {
    const signed = envelope(feed());
    const tampered = { ...signed, payload: JSON.stringify(feed({ advisories: [] })) };
    expect(readAdvisoryEnvelope(tampered, now, keys).state).toBe("unavailable");
  });

  it("rejects a feed signed by another key", () => {
    const other = generateKeyPairSync("ed25519").privateKey;
    expect(readAdvisoryEnvelope(envelope(feed(), other), now, keys).state).toBe("unavailable");
  });

  it("does not accept a core release signature as a feed signature", () => {
    const payload = JSON.stringify(feed());
    const signature = sign(null, coreReleaseSignPayload("1.0.0", "a".repeat(64)), privateKey).toString("base64");
    expect(readAdvisoryEnvelope({ payload, signature }, now, keys).state).toBe("unavailable");
  });

  it.each([null, undefined, "text", {}, { payload: 1, signature: 2 }])("rejects a malformed envelope: %j", (value) => {
    expect(readAdvisoryEnvelope(value, now, keys).state).toBe("unavailable");
  });

  it("rejects a signed feed with an invalid advisory", () => {
    const bad = feed({ advisories: [{ ...advisory, url: "http://example.test" }] });
    expect(readAdvisoryEnvelope(envelope(bad), now, keys).state).toBe("unavailable");
  });

  it("rejects a signed feed with an invalid version range", () => {
    const bad = feed({ advisories: [{ ...advisory, ranges: [{ introduced: "soon", fixed: null }] }] });
    expect(readAdvisoryEnvelope(envelope(bad), now, keys).state).toBe("unavailable");
  });
});

describe("shouldStoreEnvelope", () => {
  it("stores the first authentic feed", () => {
    expect(shouldStoreEnvelope(envelope(feed()), null, now, keys)).toBe(true);
  });

  it("stores a newer feed", () => {
    expect(shouldStoreEnvelope(envelope(feed({ sequence: 6 })), envelope(feed()), now, keys)).toBe(true);
  });

  it("refuses a replayed older feed", () => {
    expect(shouldStoreEnvelope(envelope(feed({ sequence: 4 })), envelope(feed()), now, keys)).toBe(false);
  });

  it("refuses to replace a stored feed with a forged one", () => {
    const forged = { ...envelope(feed({ sequence: 9 })), signature: "AAAA" };
    expect(shouldStoreEnvelope(forged, envelope(feed()), now, keys)).toBe(false);
  });

  it("refuses an expired feed", () => {
    const old = envelope(feed({ expiresAt: "2026-11-04T00:00:00.000Z" }));
    expect(shouldStoreEnvelope(old, null, now, keys)).toBe(false);
  });
});

describe("matchAdvisories", () => {
  const installed = (version: string) => [{ type: "plugin" as const, id: "acme.forms", version }];

  it("matches a version inside the range and reports the fix", () => {
    expect(matchAdvisories(feed(), installed("1.1.0"))).toEqual([
      { advisory, installedVersion: "1.1.0", fixedVersion: "1.2.0" },
    ]);
  });

  it("treats introduced as inclusive and fixed as exclusive", () => {
    expect(matchAdvisories(feed(), installed("1.0.0"))).toHaveLength(1);
    expect(matchAdvisories(feed(), installed("1.2.0"))).toHaveLength(0);
    expect(matchAdvisories(feed(), installed("0.9.9"))).toHaveLength(0);
  });

  it("matches every later version when no fix exists", () => {
    const open = feed({ advisories: [{ ...advisory, ranges: [{ introduced: null, fixed: null }] }] });
    expect(matchAdvisories(open, installed("9.0.0"))[0]?.fixedVersion).toBeNull();
  });

  it("does not match another package or package type", () => {
    expect(matchAdvisories(feed(), [{ type: "theme", id: "acme.forms", version: "1.1.0" }])).toEqual([]);
    expect(matchAdvisories(feed(), [{ type: "plugin", id: "acme.other", version: "1.1.0" }])).toEqual([]);
  });

  it("reports a version it cannot compare rather than assuming it is safe", () => {
    expect(matchAdvisories(feed(), installed("custom-build"))).toHaveLength(1);
  });

  it("puts the most severe match first", () => {
    const low = { ...advisory, id: "JF-LOW", severity: "low" as const };
    const critical = { ...advisory, id: "JF-CRIT", severity: "critical" as const };
    const ids = matchAdvisories(feed({ advisories: [low, critical] }), installed("1.1.0"));
    expect(ids.map((match) => match.advisory.id)).toEqual(["JF-CRIT", "JF-LOW"]);
  });
});

describe("sign-advisories script", () => {
  it("produces a feed the server accepts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jf-advisories-"));
    try {
      const input = path.join(dir, "advisories.json");
      const output = path.join(dir, "feed.json");
      fs.writeFileSync(input, JSON.stringify([advisory]));
      const script = new URL("../../../../../scripts/sign-advisories.mjs", import.meta.url).pathname;
      execFileSync(process.execPath, [script, input, output, "--sequence", "7"], {
        env: {
          ...process.env,
          JUSTFLOWS_CORE_RELEASE_KEY_FILE: "",
          JUSTFLOWS_CORE_RELEASE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        },
        stdio: "ignore",
      });
      const result = readAdvisoryEnvelope(JSON.parse(fs.readFileSync(output, "utf8")), new Date(), keys);
      expect(result).toMatchObject({ state: "current", feed: { sequence: 7 } });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
