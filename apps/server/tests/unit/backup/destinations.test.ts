// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  value: null as unknown,
  save: vi.fn(),
  sendMail: vi.fn(),
  ftpAccess: vi.fn(),
  ftpUpload: vi.fn(),
  s3Save: vi.fn(),
}));

vi.mock("../../../src/lib/settings/site-settings.js", () => ({
  getSiteSetting: async () => mocks.value,
  setSiteSetting: mocks.save,
}));
vi.mock("../../../src/lib/security/secret-box.js", () => ({
  encryptSecret: (secret: string) => `enc:${secret}`,
  decryptSecret: (secret: string) => secret.replace(/^enc:/, ""),
}));
vi.mock("../../../src/lib/email/mail.js", () => ({ sendMail: mocks.sendMail }));
vi.mock("basic-ftp", () => ({
  Client: class {
    access = mocks.ftpAccess;
    ensureDir = vi.fn();
    uploadFrom = mocks.ftpUpload;
    close = vi.fn();
  },
}));
vi.mock("@justflows/media", () => ({
  S3StorageAdapter: class {
    save = mocks.s3Save;
  },
}));

import {
  backupDestinationSettings,
  deliverBackup,
  saveBackupDestinationSettings,
} from "../../../src/lib/backup/destinations.js";

const input = {
  ftp: {
    enabled: true,
    host: "ftp.example.com",
    port: 21,
    username: "backup",
    password: "ftp-secret",
    remotePath: "/backups",
    secure: true,
  },
  email: { enabled: true, to: "admin@example.com" },
  s3: {
    enabled: true,
    bucket: "external",
    region: "eu-west-1",
    endpoint: "",
    accessKeyId: "access",
    secretAccessKey: "secret",
    prefix: "backups",
    forcePathStyle: false,
  },
};

beforeEach(() => {
  mocks.value = null;
  vi.clearAllMocks();
});

describe("backup destinations", () => {
  it("encrypts credentials and never returns them to the admin client", async () => {
    await saveBackupDestinationSettings("site-1", input);
    const stored = mocks.save.mock.calls[0]?.[2];
    expect(stored.ftp.passwordCiphertext).toBe("enc:ftp-secret");
    expect(stored.s3.secretAccessKeyCiphertext).toBe("enc:secret");
    mocks.value = stored;
    expect(await backupDestinationSettings("site-1")).toMatchObject({
      ftp: { passwordSet: true },
      s3: { accessKeySet: true, secretKeySet: true },
    });
    expect(JSON.stringify(await backupDestinationSettings("site-1"))).not.toContain("ftp-secret");
  });

  it("delivers through email, S3, and FTP", async () => {
    await saveBackupDestinationSettings("site-1", input);
    mocks.value = mocks.save.mock.calls[0]?.[2];
    mocks.sendMail.mockResolvedValue({ ok: true, response: "accepted" });
    const archive = Buffer.from("backup");
    await expect(deliverBackup("site-1", "email", "site.jfbackup", archive)).resolves.toBe(
      "admin@example.com",
    );
    await expect(deliverBackup("site-1", "s3", "site.jfbackup", archive)).resolves.toBe(
      "s3://external/backups/site.jfbackup",
    );
    await expect(deliverBackup("site-1", "ftp", "site.jfbackup", archive)).resolves.toContain(
      "ftp.example.com",
    );
    expect(mocks.sendMail).toHaveBeenCalledOnce();
    expect(mocks.s3Save).toHaveBeenCalledOnce();
    expect(mocks.ftpUpload).toHaveBeenCalledOnce();
  });

  it("refuses oversized email attachments", async () => {
    mocks.value = {
      ...input,
      ftp: { ...input.ftp, passwordCiphertext: "enc:ftp-secret" },
      s3: {
        ...input.s3,
        accessKeyIdCiphertext: "enc:access",
        secretAccessKeyCiphertext: "enc:secret",
      },
    };
    await expect(
      deliverBackup("site-1", "email", "large.jfbackup", Buffer.alloc(10 * 1024 * 1024 + 1)),
    ).rejects.toThrow("limited to 10 MB");
  });
});
