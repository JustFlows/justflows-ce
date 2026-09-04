// SPDX-License-Identifier: MIT

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireLock,
  appendUpdateLog,
  clearLock,
  clearUpdateJob,
  initUpdateStatus,
  patchUpdateStatus,
  readUpdateJob,
  readUpdateStatus,
  writeUpdateJob,
  type UpdateJob,
} from "../core-update-status.js";

let root: string;
let prevRoot: string | undefined;

beforeEach(() => {
  prevRoot = process.env.JF_ROOT;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "jf-update-status-"));
  process.env.JF_ROOT = root;
});

afterEach(() => {
  if (prevRoot === undefined) delete process.env.JF_ROOT;
  else process.env.JF_ROOT = prevRoot;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("update status", () => {
  it("returns an idle snapshot when nothing has run", () => {
    const status = readUpdateStatus();
    expect(status.running).toBe(false);
    expect(status.steps).toEqual([]);
    expect(status.log).toEqual([]);
  });

  it("tracks a run through init, patch and log append", () => {
    initUpdateStatus({ source: "upload", currentVersion: "0.1.9-dev.1", targetVersion: "0.1.9" });
    let status = readUpdateStatus();
    expect(status.running).toBe(true);
    expect(status.phase).toBe("queued");
    expect(status.targetVersion).toBe("0.1.9");

    patchUpdateStatus({ pid: process.pid, phase: "copying" });
    appendUpdateLog("✓ copy: 10 files");
    status = readUpdateStatus();
    expect(status.phase).toBe("copying");
    expect(status.log.at(-1)).toBe("✓ copy: 10 files");
  });

  it("marks a run failed when its worker process is gone", () => {
    initUpdateStatus({ source: "remote", currentVersion: "0.1.9-dev.1", targetVersion: "0.1.9" });
    // A pid that cannot be alive.
    patchUpdateStatus({ pid: 2147483000, phase: "installing" });

    const healed = readUpdateStatus();
    expect(healed.running).toBe(false);
    expect(healed.phase).toBe("failed");
    expect(healed.ok).toBe(false);
    expect(healed.error).toMatch(/exited unexpectedly/i);
  });
});

describe("update lock", () => {
  it("is exclusive while held and releasable", () => {
    expect(acquireLock("upload")).toBe(true);
    expect(acquireLock("remote")).toBe(false);
    clearLock();
    expect(acquireLock("remote")).toBe(true);
    clearLock();
  });

  it("steals a lock left behind by a dead process", () => {
    fs.mkdirSync(path.join(root, ".updates"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".updates", "lock"),
      JSON.stringify({ pid: 2147483000, source: "upload", startedAt: Date.now() }),
    );
    expect(acquireLock("remote")).toBe(true);
    clearLock();
  });
});

describe("update job descriptor", () => {
  it("round-trips and clears", () => {
    const job: UpdateJob = {
      source: "remote",
      siteId: "site_1",
      createdAt: Date.now(),
      currentVersion: "0.1.9-dev.1",
      targetVersion: "0.1.9",
      zipPath: null,
      signature: null,
      release: {
        availableVersion: "0.1.9",
        downloadUrl: "https://example.test/justflows.zip",
        sha256Url: null,
      },
      preExtractedDir: null,
    };
    writeUpdateJob(job);
    expect(readUpdateJob()).toEqual(job);
    clearUpdateJob();
    expect(readUpdateJob()).toBeNull();
  });
});
