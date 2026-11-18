// SPDX-License-Identifier: MIT

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Every backup file is encrypted with a passphrase the administrator chooses.
 *
 * A backup holds the whole site, including password hashes and credentials
 * that the database keeps encrypted with this installation's APP_SECRET. The
 * archive carries those decrypted so another installation can restore them,
 * so the archive itself must be unreadable without the passphrase.
 *
 * Layout: 8-byte magic, 4-byte big-endian header length, the JSON header (also
 * the AEAD associated data), the AES-256-GCM ciphertext, and its 16-byte tag.
 * The key comes from scrypt over the passphrase with a random salt.
 */
export const ENCRYPTED_BACKUP_MAGIC = Buffer.from("JFBKENC1", "ascii");
export const MIN_PASSPHRASE_LENGTH = 12;
export const MAX_PASSPHRASE_LENGTH = 1024;
const MAX_HEADER_BYTES = 4096;
const TAG_BYTES = 16;
const SCRYPT = { N: 1 << 15, r: 8, p: 1 } as const;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export type BackupKind = "site" | "network";

export interface EncryptedBackupHeader {
  version: 1;
  kind: BackupKind;
  createdAt: string;
  siteName: string;
  kdf: { name: "scrypt"; N: number; r: number; p: number; salt: string };
  cipher: "aes-256-gcm";
  iv: string;
}

export class BackupPassphraseError extends Error {}

/** Refuse passphrases that are too short to protect a whole site's data. */
export function assertPassphrase(passphrase: unknown): string {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new BackupPassphraseError(`Use a backup passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  if (passphrase.length > MAX_PASSPHRASE_LENGTH) throw new BackupPassphraseError("The backup passphrase is too long");
  return passphrase;
}

function deriveKey(passphrase: string, kdf: EncryptedBackupHeader["kdf"]): Buffer {
  if (kdf.name !== "scrypt" || kdf.N > 1 << 17 || kdf.r > 16 || kdf.p > 4 || kdf.N < 1 << 14) {
    throw new Error("Backup encryption settings are not supported");
  }
  return scryptSync(passphrase, Buffer.from(kdf.salt, "base64"), 32, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: SCRYPT_MAXMEM,
  });
}

export function isEncryptedBackup(file: Buffer): boolean {
  return file.byteLength > 12 && file.subarray(0, 8).equals(ENCRYPTED_BACKUP_MAGIC);
}

/** Encrypt a backup container. */
export function sealBackup(
  plaintext: Buffer,
  passphrase: string,
  meta: { kind: BackupKind; createdAt: string; siteName: string },
): Buffer {
  const header: EncryptedBackupHeader = {
    version: 1,
    kind: meta.kind,
    createdAt: meta.createdAt,
    siteName: meta.siteName.slice(0, 200),
    kdf: { name: "scrypt", ...SCRYPT, salt: randomBytes(16).toString("base64") },
    cipher: "aes-256-gcm",
    iv: randomBytes(12).toString("base64"),
  };
  const headerBytes = Buffer.from(JSON.stringify(header));
  const cipher = createCipheriv("aes-256-gcm", deriveKey(assertPassphrase(passphrase), header.kdf), Buffer.from(header.iv, "base64"));
  cipher.setAAD(headerBytes);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(headerBytes.byteLength, 0);
  return Buffer.concat([ENCRYPTED_BACKUP_MAGIC, length, headerBytes, body, cipher.getAuthTag()]);
}

/** Read the unencrypted header, which tells the backup kind before the passphrase is checked. */
export function readBackupHeader(file: Buffer): { header: EncryptedBackupHeader; headerBytes: Buffer; offset: number } {
  if (!isEncryptedBackup(file)) throw new Error("This file is not an encrypted Justflows backup");
  const length = file.readUInt32BE(8);
  if (length === 0 || length > MAX_HEADER_BYTES || 12 + length + TAG_BYTES > file.byteLength) {
    throw new Error("Backup header is invalid");
  }
  const headerBytes = file.subarray(12, 12 + length);
  let header: EncryptedBackupHeader;
  try {
    header = JSON.parse(headerBytes.toString("utf8")) as EncryptedBackupHeader;
  } catch {
    throw new Error("Backup header is invalid");
  }
  if (header.version !== 1 || header.cipher !== "aes-256-gcm" || (header.kind !== "site" && header.kind !== "network") || !header.kdf || typeof header.iv !== "string") {
    throw new Error("Backup encryption format is not supported");
  }
  return { header, headerBytes, offset: 12 + length };
}

/** Decrypt and authenticate a backup. A wrong passphrase and a changed file look the same. */
export function openBackup(file: Buffer, passphrase: string): { header: EncryptedBackupHeader; plaintext: Buffer } {
  const { header, headerBytes, offset } = readBackupHeader(file);
  const key = deriveKey(assertPassphrase(passphrase), header.kdf);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
  decipher.setAAD(headerBytes);
  decipher.setAuthTag(file.subarray(file.byteLength - TAG_BYTES));
  try {
    const plaintext = Buffer.concat([decipher.update(file.subarray(offset, file.byteLength - TAG_BYTES)), decipher.final()]);
    return { header, plaintext };
  } catch {
    throw new BackupPassphraseError("The passphrase is wrong, or the backup file was changed or damaged");
  }
}
