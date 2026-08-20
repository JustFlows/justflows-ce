import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getJfRoot } from "./jf-root.js";

export function cssProvidersInstallDir(): string {
  const rel = process.env.CSS_PROVIDERS_INSTALL_DIR ?? "css-providers-installed";
  return path.isAbsolute(rel) ? rel : path.join(getJfRoot(), rel);
}

export function getProviderNpmDependencies(manifest: Record<string, unknown>): Record<string, string> {
  const raw = manifest.dependencies ?? manifest.npmDependencies;
  if (!raw || typeof raw !== "object") return {};

  const result: Record<string, string> = {};
  for (const [name, version] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof version === "string" && version.trim()) {
      result[name] = version.trim();
    }
  }
  return result;
}

function runCommand(cmd: string, args: string[], cwd: string, label: string): void {
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: "pipe",
    encoding: "utf-8",
    timeout: 180_000,
    env: { ...process.env, NODE_ENV: "production" },
  });

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`${label} failed${detail ? `: ${detail}` : ""}`);
  }
}

async function runPostInstall(manifest: Record<string, unknown>, installDir: string): Promise<void> {
  const postInstall = manifest.postInstall;
  if (!postInstall || typeof postInstall !== "object") return;

  const cfg = postInstall as Record<string, unknown>;
  if (cfg.type !== "tailwind") return;

  const inputRel = typeof cfg.input === "string" ? cfg.input : "";
  const inputSrc = inputRel
    ? (path.isAbsolute(inputRel) ? inputRel : path.join(getJfRoot(), inputRel))
    : path.join(installDir, "input.css");
  const inputDest = path.join(installDir, "input.css");

  if (fs.existsSync(inputSrc)) {
    await fsp.copyFile(inputSrc, inputDest);
  } else if (!fs.existsSync(inputDest)) {
    await fsp.writeFile(
      inputDest,
      '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n',
      "utf-8",
    );
  }

  const output = typeof cfg.output === "string" ? cfg.output : "dist/tailwind.css";
  await fsp.mkdir(path.dirname(path.join(installDir, output)), { recursive: true });

  runCommand(
    "npx",
    ["--yes", "tailwindcss", "-i", "input.css", "-o", output, "--minify"],
    installDir,
    "Tailwind CSS build",
  );
}

/**
 * Replace the active CSS provider npm packages.
 * Clears previous node_modules and installs only the selected provider's dependencies.
 */
export async function swapCssProviderPackages(manifest: Record<string, unknown> | null): Promise<void> {
  const installDir = cssProvidersInstallDir();
  await fsp.mkdir(installDir, { recursive: true });

  const deps = manifest ? getProviderNpmDependencies(manifest) : {};

  await fsp.rm(path.join(installDir, "node_modules"), { recursive: true, force: true });
  await fsp.rm(path.join(installDir, "dist"), { recursive: true, force: true });
  await fsp.rm(path.join(installDir, "package-lock.json"), { force: true });

  const packageJson = {
    name: "justflows-css-provider-active",
    private: true,
    version: "1.0.0",
    dependencies: deps,
  };

  await fsp.writeFile(path.join(installDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf-8");

  if (Object.keys(deps).length === 0) return;

  runCommand("npm", ["install", "--omit=dev", "--ignore-scripts"], installDir, "CSS provider npm install");

  if (manifest) {
    await runPostInstall(manifest, installDir);
  }
}

export function resolveInstalledAssetPath(relativePath: string): string | null {
  const installDir = cssProvidersInstallDir();
  const normalized = path
    .normalize(relativePath.replace(/^\.?\//, ""))
    .replace(/^(\.\.(\/|\\|$))+/, "")
    .replace(/^node_modules[/\\]/, "");

  const candidates = [
    path.join(installDir, normalized),
    path.join(installDir, "node_modules", normalized),
  ];

  const resolvedInstall = path.resolve(installDir);
  for (const candidate of candidates) {
    const resolvedFile = path.resolve(candidate);
    if (!resolvedFile.startsWith(resolvedInstall)) continue;
    if (fs.existsSync(resolvedFile)) return resolvedFile;
  }
  return null;
}
