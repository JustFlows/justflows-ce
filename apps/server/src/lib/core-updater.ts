import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getJfRoot } from "./jf-root.js";
import { requestPassengerRestart } from "./app-restart.js";
import { verifyUpdateArchiveSignature } from "./package-trust.js";
import { extractZipSafely, resolvePathUnderRoot } from "./safe-zip.js";

export interface UpdateStep {
  step: string;
  ok: boolean;
  detail?: string;
}

const MAX_ZIP_BYTES = 200 * 1024 * 1024; // 200 MB

/** Paths never overwritten during a core update. */
const PRESERVE_TOP_LEVEL = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "uploads",
  "packages-installed",
  ".updates",
  "node_modules",
]);

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 15 * 60 * 1000,
): { ok: boolean; output: string } {
  const result = spawnSync(/* turbopackIgnore: true */ cmd, args, {
    cwd,
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? "production" },
  });

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return { ok: result.status === 0, output };
}


async function walkFiles(dir: string, base = dir): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(full, base));
    } else {
      files.push(path.relative(base, full));
    }
  }
  return files;
}

function shouldPreserve(relativePath: string): boolean {
  const top = relativePath.split(path.sep)[0] ?? relativePath;
  if (PRESERVE_TOP_LEVEL.has(top)) return true;
  if (relativePath.startsWith(".updates" + path.sep)) return true;
  return false;
}

async function copyUpdateFiles(sourceRoot: string, destRoot: string): Promise<number> {
  const files = await walkFiles(sourceRoot);
  let copied = 0;

  for (const rel of files) {
    if (shouldPreserve(rel)) continue;

    const dest = resolvePathUnderRoot(destRoot, rel);
    if (!dest) continue;

    const src = path.join(sourceRoot, rel);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest);
    copied++;
  }

  return copied;
}

function findExtractedRoot(extractDir: string): string {
  // Flat layout: files at archive root (current justflows.zip format).
  if (fs.existsSync(path.join(extractDir, "server.js"))) {
    return extractDir;
  }

  // Legacy layout: top-level folder (e.g. justflows/server.js).
  const entries = fs.readdirSync(extractDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "__MACOSX") continue;
    const candidate = path.join(extractDir, entry.name);
    if (fs.existsSync(path.join(candidate, "server.js"))) {
      return candidate;
    }
  }

  throw new Error("Invalid Justflows zip — expected server.js at archive root");
}

function validateUpdatePackage(sourceRoot: string): { ok: true; version: string } | { ok: false; detail: string } {
  const serverJs = path.join(sourceRoot, "server.js");
  const pkgPath = path.join(sourceRoot, "package.json");

  if (!fs.existsSync(serverJs)) {
    return { ok: false, detail: "Invalid update package — missing server.js" };
  }
  if (!fs.existsSync(pkgPath)) {
    return { ok: false, detail: "Invalid update package — missing package.json" };
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { name?: string; version?: string };
    if (pkg.name && pkg.name !== "justflows") {
      return { ok: false, detail: `Invalid update package — unexpected name "${pkg.name}"` };
    }
    return { ok: true, version: pkg.version ?? "unknown" };
  } catch {
    return { ok: false, detail: "Invalid update package — unreadable package.json" };
  }
}

function readVersion(root: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function applyCoreUpdate(
  uploadBuffer: Buffer,
  filename: string,
  options?: { signature?: string },
): Promise<{
  ok: boolean;
  steps: UpdateStep[];
  currentVersion: string;
  newVersion: string;
  restartRequired: boolean;
  restarting: boolean;
}> {
  const steps: UpdateStep[] = [];
  const root = getJfRoot();
  const currentVersion = readVersion(root);

  if (!filename.endsWith(".zip")) {
    return {
      ok: false,
      steps: [{ step: "validate", ok: false, detail: "Only .zip files are accepted" }],
      currentVersion,
      newVersion: currentVersion,
      restartRequired: false,
      restarting: false,
    };
  }

  if (uploadBuffer.byteLength > MAX_ZIP_BYTES) {
    return {
      ok: false,
      steps: [{ step: "validate", ok: false, detail: "File too large (max 200 MB)" }],
      currentVersion,
      newVersion: currentVersion,
      restartRequired: false,
      restarting: false,
    };
  }

  const stagingDir = path.join(root, ".updates", "staging");
  const extractDir = path.join(stagingDir, "extract");
  const zipPath = path.join(stagingDir, "upload.zip");

  try {
    await fsp.rm(stagingDir, { recursive: true, force: true });
    await fsp.mkdir(stagingDir, { recursive: true });

    await fsp.writeFile(zipPath, uploadBuffer);
    const digest = createHash("sha256").update(uploadBuffer).digest("hex");
    steps.push({
      step: "upload",
      ok: true,
      detail: `Saved ${(uploadBuffer.byteLength / 1024 / 1024).toFixed(1)} MB (sha256: ${digest.slice(0, 12)}…)`,
    });

    const expectedDigest = process.env.JUSTFLOWS_UPDATE_DIGEST?.trim().toLowerCase();
    if (expectedDigest && digest !== expectedDigest) {
      steps.push({
        step: "validate",
        ok: false,
        detail: "Update digest does not match JUSTFLOWS_UPDATE_DIGEST",
      });
      return { ok: false, steps, currentVersion, newVersion: currentVersion, restartRequired: false, restarting: false };
    }

    verifyUpdateArchiveSignature(uploadBuffer, options?.signature);
    if (process.env.JUSTFLOWS_UPDATE_SIGNING_KEY) {
      steps.push({ step: "signature", ok: true, detail: "Update signature verified" });
    }

    extractZipSafely(zipPath, extractDir);
    steps.push({ step: "extract", ok: true, detail: "Archive extracted" });

    const sourceRoot = findExtractedRoot(extractDir);
    const validated = validateUpdatePackage(sourceRoot);
    if (!validated.ok) {
      steps.push({ step: "validate", ok: false, detail: validated.detail });
      return { ok: false, steps, currentVersion, newVersion: currentVersion, restartRequired: false, restarting: false };
    }
    const newVersion = validated.version;
    steps.push({ step: "validate", ok: true, detail: `Package verified (v${newVersion})` });

    const copied = await copyUpdateFiles(sourceRoot, root);
    steps.push({
      step: "copy",
      ok: true,
      detail: `Updated ${copied} files (.env and uploads preserved)`,
    });

    const npmInstall = runCommand("npm", ["install", "--ignore-scripts"], root);
    steps.push({
      step: "npm install",
      ok: npmInstall.ok,
      detail: npmInstall.ok
        ? "Dependencies installed"
        : npmInstall.output.slice(-500) || "npm install failed",
    });
    if (!npmInstall.ok) {
      return { ok: false, steps, currentVersion, newVersion, restartRequired: false, restarting: false };
    }

    const hasBuiltServer =
      fs.existsSync(path.join(root, "apps/server/dist/server.js")) &&
      fs.existsSync(path.join(root, "apps/server/admin-ui/dist/index.html"));

    if (hasBuiltServer) {
      steps.push({
        step: "build",
        ok: true,
        detail: "Using pre-built artifacts from update package",
      });
    } else {
      const build = runCommand("node", ["scripts/install-all.js", "--build-only"], root);
      steps.push({
        step: "build",
        ok: build.ok,
        detail: build.ok
          ? "Server rebuilt"
          : build.output.slice(-500) || "build:server failed",
      });
      if (!build.ok) {
        return { ok: false, steps, currentVersion, newVersion, restartRequired: false, restarting: false };
      }
    }

    const restart = await requestPassengerRestart(root);
    steps.push({
      step: "restart",
      ok: restart.ok,
      detail: restart.ok
        ? "Touched tmp/restart.txt — app reloads on next request"
        : restart.error ?? "Could not trigger restart",
    });

    steps.push({
      step: "complete",
      ok: true,
      detail: `Updated from v${currentVersion} to v${newVersion}`,
    });

    return {
      ok: true,
      steps,
      currentVersion,
      newVersion,
      restartRequired: !restart.ok,
      restarting: restart.ok,
    };
  } catch (err) {
    steps.push({
      step: "error",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      steps,
      currentVersion,
      newVersion: currentVersion,
      restartRequired: false,
      restarting: false,
    };
  } finally {
    await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
}
