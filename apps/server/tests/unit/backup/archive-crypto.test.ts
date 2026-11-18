// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  BackupPassphraseError,
  isEncryptedBackup,
  openBackup,
  readBackupHeader,
  sealBackup,
} from "../../../src/lib/backup/archive-crypto.js";

const passphrase = "correct horse battery staple";
const meta = { kind: "network" as const, createdAt: "2026-11-18T10:00:00.000Z", siteName: "Root" };

describe("backup encryption", () => {
  it("round-trips and exposes only the header without the passphrase", () => {
    const sealed = sealBackup(Buffer.from("site data with secrets"), passphrase, meta);
    expect(isEncryptedBackup(sealed)).toBe(true);
    expect(sealed.includes(Buffer.from("secrets"))).toBe(false);
    expect(readBackupHeader(sealed).header).toMatchObject({ kind: "network", siteName: "Root" });
    expect(openBackup(sealed, passphrase).plaintext.toString()).toBe("site data with secrets");
  });

  it("refuses a wrong passphrase", () => {
    const sealed = sealBackup(Buffer.from("data"), passphrase, meta);
    expect(() => openBackup(sealed, "another long passphrase")).toThrow(BackupPassphraseError);
  });

  it("refuses a changed header, because the header is authenticated", () => {
    const sealed = sealBackup(Buffer.from("data"), passphrase, meta);
    const text = sealed.toString("latin1").replace('"kind":"network"', '"kind":"site"   ');
    const changed = Buffer.from(text, "latin1");
    expect(() => openBackup(changed, passphrase)).toThrow(BackupPassphraseError);
  });

  it("refuses changed ciphertext", () => {
    const sealed = sealBackup(Buffer.from("data data data"), passphrase, meta);
    sealed[sealed.byteLength - 20] = sealed[sealed.byteLength - 20]! ^ 1;
    expect(() => openBackup(sealed, passphrase)).toThrow(BackupPassphraseError);
  });

  it("refuses short passphrases", () => {
    expect(() => sealBackup(Buffer.from("x"), "short", meta)).toThrow(/at least 12/);
  });
});
