// SPDX-License-Identifier: MIT
import fs from "node:fs/promises";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ command: vi.fn(), restart: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: vi.fn(), spawnSync: mocks.command }));
vi.mock("../../../src/lib/runtime/app-restart.js", () => ({ requestAppRestart: mocks.restart }));
vi.mock("../../../src/lib/extensions/package-trust.js", () => ({ assertCoreUpdateIsTrusted: () => "Verified test package" }));
import { applyCoreUpdate } from "../../../src/lib/updates/core-updater.js";

let root: string;
let source: string;
async function write(base: string, name: string, content: string) {
  const file = path.join(base, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

beforeEach(async () => {
  vi.resetAllMocks();
  root = await fs.mkdtemp(path.join(os.tmpdir(), "jf-rollback-"));
  source = path.join(root, ".updates", "staging", "extract");
  vi.stubEnv("JF_ROOT", root);
  for (const base of [root, source]) {
    await write(base, "server.js", base === root ? "old server" : "new server");
    await write(base, "package.json", JSON.stringify({ name: "justflows", version: base === root ? "1.0.0" : "1.1.0" }));
  }
  await write(root, "obsolete.js", "restore me");
  await write(root, "node_modules/dependency/index.js", "old dependency");
  await write(root, ".env", "preserve environment");
  await write(root, "uploads/photo.txt", "preserve upload");
  await write(root, "storage/private/site/file.txt", "private bytes");
  await write(source, "added.js", "new only");
  await write(source, "node_modules/dependency/index.js", "new dependency");
  await write(source, "apps/server/dist/lib/database/apply-pending-migrations-cli.js", "migration");
  await write(source, "apps/server/dist/server.js", "built server");
  await write(source, "apps/server/admin-ui/dist/client/index.html", "client");
  await write(source, "apps/server/admin-ui/dist/server/entry-server.js", "ssr");
  mocks.command.mockReturnValue({ status: 0, stdout: "", stderr: "" });
  mocks.restart.mockResolvedValue({ ok: true, method: "passenger", detail: "Restart queued" });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

async function apply() {
  return applyCoreUpdate(Buffer.from("test archive"), "release.zip", { preExtractedDir: source });
}
async function expectRestored() {
  expect(await fs.readFile(path.join(root, "server.js"), "utf8")).toBe("old server");
  expect(await fs.readFile(path.join(root, "obsolete.js"), "utf8")).toBe("restore me");
  expect(await fs.readFile(path.join(root, "node_modules/dependency/index.js"), "utf8")).toBe("old dependency");
  expect(await fs.readFile(path.join(root, ".env"), "utf8")).toBe("preserve environment");
  expect(await fs.readFile(path.join(root, "uploads/photo.txt"), "utf8")).toBe("preserve upload");
  expect(await fs.readFile(path.join(root, "storage/private/site/file.txt"), "utf8")).toBe("private bytes");
  await expect(fs.stat(path.join(root, "added.js"))).rejects.toMatchObject({ code: "ENOENT" });
}

describe("core update recovery", () => {
  it("restores overwritten and pruned files after migration failure without restarting", async () => {
    mocks.command.mockImplementation((_cmd, args) => args[0] === "install"
      ? { status: 0, stdout: "" }
      : { status: 1, stdout: "", stderr: "migration failed" });
    const result = await apply();
    expect(result.ok).toBe(false);
    expect(result.newVersion).toBe("1.0.0");
    expect(result.steps).toContainEqual(expect.objectContaining({ step: "rollback", ok: true }));
    expect(mocks.command).toHaveBeenCalledTimes(2);
    expect(mocks.restart).not.toHaveBeenCalled();
    await expectRestored();
  });

  it("leaves live files untouched when staged dependency installation fails", async () => {
    mocks.command.mockImplementation((_cmd, args) => {
      if (args[0] === "install") {
        /** Simulate an installer changing files before it exits unsuccessfully. */
        writeFileSync(path.join(source, "node_modules/dependency/index.js"), "broken dependency");
        return { status: 1, stderr: "install failed" };
      }
      return { status: 0, stdout: "" };
    });
    expect((await apply()).ok).toBe(false);
    expect(mocks.restart).not.toHaveBeenCalled();
    await expectRestored();
  });

  it("leaves the live release untouched when a staged build fails", async () => {
    await fs.rm(path.join(source, "apps/server/dist/server.js"));
    mocks.command.mockImplementation((_cmd, args) => ({ status: args[0] === "install" ? 0 : 1, stderr: "build failed" }));
    const result = await apply();
    expect(result.ok).toBe(false);
    expect(result.steps.some(step => step.step === "copy")).toBe(false);
    expect(mocks.restart).not.toHaveBeenCalled();
    await expectRestored();
  });

  it("restores the old release if a restart cannot be requested", async () => {
    mocks.restart.mockResolvedValue({ ok: false, error: "No supervisor" });
    expect((await apply()).ok).toBe(false);
    await expectRestored();
  });

  it("restores the previous release after a partial copy failure", async () => {
    vi.spyOn(fs, "copyFile").mockRejectedValueOnce(new Error("disk write failed"));
    const result = await apply();
    expect(result.ok).toBe(false);
    expect(result.steps).toContainEqual(expect.objectContaining({ step: "rollback", ok: true }));
    expect(mocks.restart).not.toHaveBeenCalled();
    await expectRestored();
  });

  it("retains the backup and reports manual recovery when restore fails", async () => {
    const originalCopy = fs.cp.bind(fs);
    vi.spyOn(fs, "cp").mockImplementation(async (from, to, options) => {
      if (String(from).includes("previous-release")) throw new Error("restore unavailable");
      return originalCopy(from, to, options);
    });
    mocks.command.mockImplementation((_cmd, args) => ({ status: args[0] === "install" ? 0 : 1, stderr: "migration failed" }));
    const result = await apply();
    expect(result.ok).toBe(false);
    expect(result.restartRequired).toBe(true);
    expect(result.steps).toContainEqual(expect.objectContaining({ step: "rollback", ok: false }));
    expect(await fs.readFile(path.join(root, ".updates/previous-release/server.js"), "utf8")).toBe("old server");
    expect(mocks.restart).not.toHaveBeenCalled();
  });

  it("keeps the new release on success", async () => {
    expect((await apply()).ok).toBe(true);
    expect(await fs.readFile(path.join(root, "server.js"), "utf8")).toBe("new server");
    expect(mocks.restart).toHaveBeenCalledOnce();
    expect(await fs.readFile(path.join(root, ".updates/previous-release/server.js"), "utf8")).toBe("old server");
    expect(await fs.readFile(path.join(root, "node_modules/dependency/index.js"), "utf8")).toBe("new dependency");
    expect(await fs.readFile(path.join(root, "storage/private/site/file.txt"), "utf8")).toBe("private bytes");
  });

  it("keeps private storage and the last recoverable release across two updates", async () => {
    vi.stubEnv("PRIVATE_STORAGE_PATH", "custom-runtime/files");
    await write(root, "custom-runtime/keep.txt", "custom");
    expect((await apply()).ok).toBe(true);
    await write(source, "server.js", "newer server");
    await write(source, "package.json", JSON.stringify({ name: "justflows", version: "1.2.0" }));
    await write(source, "apps/server/dist/lib/database/apply-pending-migrations-cli.js", "migration");
    await write(source, "apps/server/dist/server.js", "built server");
    await write(source, "apps/server/admin-ui/dist/client/index.html", "client");
    await write(source, "apps/server/admin-ui/dist/server/entry-server.js", "ssr");
    expect((await apply()).ok).toBe(true);
    expect(await fs.readFile(path.join(root, "server.js"), "utf8")).toBe("newer server");
    expect(await fs.readFile(path.join(root, "storage/private/site/file.txt"), "utf8")).toBe("private bytes");
    expect(await fs.readFile(path.join(root, "custom-runtime/keep.txt"), "utf8")).toBe("custom");
    expect(await fs.readFile(path.join(root, "uploads/photo.txt"), "utf8")).toBe("preserve upload");
    expect(await fs.readFile(path.join(root, ".updates/previous-release/server.js"), "utf8")).toBe("new server");
  });
});
