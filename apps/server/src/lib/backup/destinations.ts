// SPDX-License-Identifier: MIT

import { Readable } from "node:stream";
import { Client } from "basic-ftp";
import { S3StorageAdapter } from "@justflows/media";
import { getSiteSetting, setSiteSetting } from "../settings/site-settings.js";
import { decryptSecret, encryptSecret } from "../security/secret-box.js";
import { sendMail } from "../email/mail.js";

const SETTING_KEY = "backup_destination_credentials";
const EMAIL_BACKUP_LIMIT = 10 * 1024 * 1024;

export interface BackupDestinationInput {
  ftp: {
    enabled: boolean;
    host: string;
    port: number;
    username: string;
    password?: string;
    remotePath: string;
    secure: boolean;
  };
  email: { enabled: boolean; to: string };
  s3: {
    enabled: boolean;
    bucket: string;
    region: string;
    endpoint: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    prefix: string;
    forcePathStyle: boolean;
  };
}

interface StoredBackupDestinations {
  ftp: Omit<BackupDestinationInput["ftp"], "password"> & { passwordCiphertext: string };
  email: BackupDestinationInput["email"];
  s3: Omit<BackupDestinationInput["s3"], "accessKeyId" | "secretAccessKey"> & {
    accessKeyIdCiphertext: string;
    secretAccessKeyCiphertext: string;
  };
}

const defaults = (): StoredBackupDestinations => ({
  ftp: {
    enabled: false,
    host: "",
    port: 21,
    username: "",
    passwordCiphertext: "",
    remotePath: "/",
    secure: true,
  },
  email: { enabled: false, to: "" },
  s3: {
    enabled: false,
    bucket: "",
    region: "us-east-1",
    endpoint: "",
    accessKeyIdCiphertext: "",
    secretAccessKeyCiphertext: "",
    prefix: "justflows-backups",
    forcePathStyle: false,
  },
});

async function stored(siteId: string): Promise<StoredBackupDestinations> {
  const value = await getSiteSetting<Partial<StoredBackupDestinations>>(siteId, SETTING_KEY);
  const base = defaults();
  return {
    ftp: { ...base.ftp, ...value?.ftp },
    email: { ...base.email, ...value?.email },
    s3: { ...base.s3, ...value?.s3 },
  };
}

/** Public configuration never returns destination credentials. */
export async function backupDestinationSettings(siteId: string) {
  const value = await stored(siteId);
  const { passwordCiphertext, ...ftp } = value.ftp;
  const { accessKeyIdCiphertext, secretAccessKeyCiphertext, ...s3 } = value.s3;
  return {
    ftp: { ...ftp, passwordSet: Boolean(passwordCiphertext) },
    email: value.email,
    s3: {
      ...s3,
      accessKeySet: Boolean(accessKeyIdCiphertext),
      secretKeySet: Boolean(secretAccessKeyCiphertext),
    },
  };
}

export async function saveBackupDestinationSettings(
  siteId: string,
  input: BackupDestinationInput,
): Promise<void> {
  const current = await stored(siteId);
  const { password, ...ftp } = input.ftp;
  const { accessKeyId, secretAccessKey, ...s3 } = input.s3;
  await setSiteSetting(siteId, SETTING_KEY, {
    ftp: {
      ...ftp,
      passwordCiphertext: password ? encryptSecret(password) : current.ftp.passwordCiphertext,
    },
    email: input.email,
    s3: {
      ...s3,
      accessKeyIdCiphertext: accessKeyId
        ? encryptSecret(accessKeyId)
        : current.s3.accessKeyIdCiphertext,
      secretAccessKeyCiphertext: secretAccessKey
        ? encryptSecret(secretAccessKey)
        : current.s3.secretAccessKeyCiphertext,
    },
  } satisfies StoredBackupDestinations);
}

export type BackupDestination = "ftp" | "email" | "s3";

export async function deliverBackup(
  siteId: string,
  destination: BackupDestination,
  filename: string,
  archive: Buffer,
): Promise<string> {
  const config = await stored(siteId);
  if (destination === "email") {
    if (!config.email.enabled || !config.email.to)
      throw new Error("Email backup destination is not configured");
    if (archive.byteLength > EMAIL_BACKUP_LIMIT)
      throw new Error("Email backups are limited to 10 MB; use FTP, S3, or local download");
    const result = await sendMail({
      to: config.email.to,
      subject: `Justflows backup — ${filename}`,
      text: "Your requested Justflows backup is attached. Store it securely.",
      type: "backup",
      transactional: true,
      attachments: [{ filename, content: archive, contentType: "application/octet-stream" }],
    });
    if (!result.ok) throw new Error(result.error);
    return config.email.to;
  }
  if (destination === "s3") {
    if (!config.s3.enabled || !config.s3.bucket)
      throw new Error("S3 backup destination is not configured");
    const accessKeyId = decryptSecret(config.s3.accessKeyIdCiphertext);
    const secretAccessKey = decryptSecret(config.s3.secretAccessKeyCiphertext);
    if (!accessKeyId || !secretAccessKey) throw new Error("S3 backup credentials are missing");
    const adapter = new S3StorageAdapter({
      bucket: config.s3.bucket,
      region: config.s3.region,
      ...(config.s3.endpoint ? { endpoint: config.s3.endpoint } : {}),
      accessKeyId,
      secretAccessKey,
      forcePathStyle: config.s3.forcePathStyle,
    });
    const key = `${config.s3.prefix.replace(/^\/+|\/+$/g, "")}/${filename}`.replace(/^\//, "");
    await adapter.save(key, archive, "application/octet-stream");
    return `s3://${config.s3.bucket}/${key}`;
  }
  if (!config.ftp.enabled || !config.ftp.host)
    throw new Error("FTP backup destination is not configured");
  const password = decryptSecret(config.ftp.passwordCiphertext);
  if (!password) throw new Error("FTP backup password is missing");
  const client = new Client(30_000);
  try {
    await client.access({
      host: config.ftp.host,
      port: config.ftp.port,
      user: config.ftp.username,
      password,
      secure: config.ftp.secure,
    });
    await client.ensureDir(config.ftp.remotePath || "/");
    await client.uploadFrom(Readable.from(archive), filename);
    return `${config.ftp.host}:${config.ftp.remotePath}/${filename}`;
  } finally {
    client.close();
  }
}
