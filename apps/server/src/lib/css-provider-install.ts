import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getJfRoot } from "./jf-root.js";
import { resolvePathUnderBase } from "./safe-path.js";

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

/**
 * Build the provider's stylesheet.
 *
 * Everything here is driven by manifest fields written by whoever authored the
 * package, so each one is treated as untrusted input:
 *
 *  - `input` may only name a file inside the package directory. It used to be
 *    resolved against the app root (or used as-is when absolute), which meant a
 *    manifest could copy any file on the host — `.env` included — into
 *    `input.css`, a path the public asset route then served.
 *  - `output` is confined to the provider's own `dist/`, so it cannot overwrite
 *    application files, and may not begin with `-` (argument injection).
 *  - Tailwind is invoked through its resolved binary inside the install
 *    directory rather than `npx --yes`, which would fetch and execute whatever
 *    the manifest's dependency specifier resolved to — defeating the
 *    `--ignore-scripts` on the install above.
 */
async function runPostInstall(
  manifest: Record<string, unknown>,
  installDir: string,
): Promise<void> {
  const postInstall = manifest.postInstall;
  if (!postInstall || typeof postInstall !== "object") return;

  const cfg = postInstall as Record<string, unknown>;
  if (cfg.type !== "tailwind") return;

  const inputDest = path.join(installDir, "input.css");
  const packageDir = typeof manifest.installedPath === "string" ? manifest.installedPath : null;
  const inputRel = typeof cfg.input === "string" ? cfg.input.trim() : "";

  let copied = false;
  if (inputRel && packageDir) {
    const inputSrc = resolvePathUnderBase(packageDir, inputRel);
    if (!inputSrc) {
      throw new Error(
        `CSS provider postInstall.input must stay inside the package directory (got "${inputRel}")`,
      );
    }
    try {
      await fsp.copyFile(inputSrc, inputDest);
      copied = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  if (!copied) {
    try {
      await fsp.writeFile(
        inputDest,
        "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n",
        { encoding: "utf-8", flag: "wx" },
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }

  const outputRel = typeof cfg.output === "string" ? cfg.output.trim() : "";
  const output = outputRel || "dist/tailwind.css";
  if (output.startsWith("-")) {
    throw new Error(`CSS provider postInstall.output may not start with "-" (got "${output}")`);
  }
  const distDir = path.join(installDir, "dist");
  const outputAbs = resolvePathUnderBase(distDir, path.relative("dist", output) || output);
  if (!outputAbs) {
    throw new Error(
      `CSS provider postInstall.output must stay inside the provider's dist/ directory (got "${output}")`,
    );
  }
  await fsp.mkdir(path.dirname(outputAbs), { recursive: true });

  const tailwindBin = resolvePathUnderBase(installDir, "node_modules/.bin/tailwindcss");
  if (!tailwindBin || !fs.existsSync(tailwindBin)) {
    throw new Error(
      "CSS provider declares a Tailwind build but does not depend on tailwindcss — " +
        "add it to the package's dependencies.",
    );
  }

  runCommand(
    tailwindBin,
    ["-i", inputDest, "-o", outputAbs, "--minify"],
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

/**
 * Directories the public /css-providers route may read from. Anything else in
 * the install directory is build scaffolding — package.json, package-lock.json,
 * and input.css, which is a build input rather than a published asset.
 */
const SERVABLE_ROOTS = ["node_modules", "dist"] as const;

export function resolveInstalledAssetPath(relativePath: string): string | null {
  const installDir = cssProvidersInstallDir();
  const normalized = path
    .normalize(relativePath.replace(/^\.?\//, ""))
    .replace(/^(\.\.(\/|\\|$))+/, "")
    .replace(/^node_modules[/\\]/, "");

  if (!normalized || path.isAbsolute(normalized)) return null;

  for (const root of SERVABLE_ROOTS) {
    const base = path.join(installDir, root);
    // A manifest href may name the root explicitly ("dist/tailwind.css") or omit
    // it ("tailwindcss/tailwind.css", where resolveAssetUrl stripped
    // "node_modules/"), so try both against each root.
    const withoutRoot = normalized.startsWith(`${root}/`)
      ? normalized.slice(root.length + 1)
      : normalized;

    for (const candidate of new Set([withoutRoot, normalized])) {
      if (!candidate) continue;
      // resolvePathUnderBase appends the separator before comparing, so a
      // sibling directory such as "css-providers-installed-x" cannot satisfy the
      // check, and it resolves symlinks so a link inside the package cannot
      // point out of it.
      const resolved = resolvePathUnderBase(base, candidate);
      if (resolved && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return resolved;
      }
    }
  }
  return null;
}
