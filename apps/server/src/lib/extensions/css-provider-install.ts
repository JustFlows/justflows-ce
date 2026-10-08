import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getJfRoot } from "../runtime/jf-root.js";
import { resolveNpmBin } from "../runtime/node-bin.js";
import { resolvePathUnderBase } from "../security/safe-path.js";

export function cssProvidersInstallDir(): string {
  const rel = process.env.CSS_PROVIDERS_INSTALL_DIR ?? "css-providers-installed";
  return path.isAbsolute(rel) ? rel : path.join(getJfRoot(), rel);
}

/** npm package name, scoped or plain. */
const NPM_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/**
 * Registry versions and ranges only — digits, dots, and the range operators.
 *
 * npm specifiers are not limited to versions: `https://evil.example/x.tgz`, a
 * git URL, and `file:../../` are all valid and were all accepted straight from
 * the manifest. `--ignore-scripts` does not help, because runPostInstall then
 * executes node_modules/.bin/tailwindcss out of whatever that resolved to.
 */
const NPM_RANGE_RE = /^[\d\sxX*.^~><=|\-+A-Za-z]{1,64}$/;
const NPM_RANGE_FORBIDDEN = /[:/\\]/;

export function isSafeNpmName(name: string): boolean {
  return name.length <= 214 && NPM_NAME_RE.test(name);
}

export function isSafeNpmRange(range: string): boolean {
  return !NPM_RANGE_FORBIDDEN.test(range) && NPM_RANGE_RE.test(range);
}

export function getProviderNpmDependencies(manifest: Record<string, unknown>): Record<string, string> {
  const raw = manifest.dependencies ?? manifest.npmDependencies;
  if (!raw || typeof raw !== "object") return {};

  const result: Record<string, string> = {};
  for (const [name, version] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof version !== "string" || !version.trim()) continue;
    const range = version.trim();
    if (!isSafeNpmName(name)) {
      throw new Error(`CSS provider dependency name is not a valid npm package: "${name}"`);
    }
    if (!isSafeNpmRange(range)) {
      throw new Error(
        `CSS provider dependency "${name}" must name a published version or range, ` +
          `not a URL, git reference or local path (got "${range}")`,
      );
    }
    result[name] = range;
  }
  return result;
}

function runCommand(cmd: string, args: string[], cwd: string, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        cwd,
        encoding: "utf-8",
        timeout: 180_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, NODE_ENV: "production" },
      },
      (error, stdout, stderr) => {
        if (!error) return resolve();
        const detail = (stderr || stdout || "").trim().slice(0, 2000);
        reject(new Error(`${label} failed${detail ? `: ${detail}` : ""}`));
      },
    );
  });
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

  await runCommand(
    tailwindBin,
    ["-i", inputDest, "-o", outputAbs, "--minify"],
    installDir,
    "Tailwind CSS build",
  );
}

/**
 * Each distinct provider build lives in its own folder, named by a hash of
 * everything that goes into it (dependencies, build config, and the package
 * folder, which is itself content-addressed). Builds are never replaced or
 * removed by activation, so one site switching providers cannot change or
 * delete the stylesheet another site is serving.
 */
export function cssProviderBuildKey(manifest: Record<string, unknown> | null): string | null {
  if (!manifest) return null;
  const deps = getProviderNpmDependencies(manifest);
  if (Object.keys(deps).length === 0) return null;
  const source = {
    deps: Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))),
    postInstall: manifest.postInstall ?? null,
    installedPath: typeof manifest.installedPath === "string" ? manifest.installedPath : null,
    bundledPath: typeof manifest.bundledPath === "string" ? manifest.bundledPath : null,
    registry: process.env.NPM_REGISTRY || "https://registry.npmjs.org/",
  };
  return createHash("sha256").update(JSON.stringify(source)).digest("hex").slice(0, 24);
}

const BUILD_KEY_RE = /^[a-f0-9]{24}$/;
const COMPLETE_MARKER = ".complete";

function buildsRoot(): string {
  return path.join(cssProvidersInstallDir(), "builds");
}

export function cssProviderBuildDir(key: string): string | null {
  if (!BUILD_KEY_RE.test(key)) return null;
  return resolvePathUnderBase(buildsRoot(), key);
}

function buildIsComplete(dir: string): boolean {
  return fs.existsSync(path.join(dir, COMPLETE_MARKER));
}

// One build at a time for the whole process, and one in flight per key: a
// build runs npm and Tailwind, which are expensive and shared.
let buildQueue: Promise<unknown> = Promise.resolve();
const inFlight = new Map<string, Promise<void>>();

async function buildInto(manifest: Record<string, unknown>, key: string, finalDir: string): Promise<void> {
  if (buildIsComplete(finalDir)) return;
  const staging = path.join(buildsRoot(), `.staging-${key}-${randomUUID()}`);
  await fsp.mkdir(staging, { recursive: true });
  try {
    const packageJson = {
      name: "justflows-css-provider-build",
      private: true,
      version: "1.0.0",
      dependencies: getProviderNpmDependencies(manifest),
    };
    await fsp.writeFile(path.join(staging, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf-8");
    await runCommand(
      resolveNpmBin(),
      [
        "install",
        "--omit=dev",
        // Does not sandbox the install: runPostInstall executes a binary out of
        // the tree this produces. It only stops a package's own lifecycle scripts
        // from running before we get there.
        "--ignore-scripts",
        "--registry",
        process.env.NPM_REGISTRY || "https://registry.npmjs.org/",
      ],
      staging,
      "CSS provider npm install",
    );
    await runPostInstall(manifest, staging);
    await fsp.writeFile(path.join(staging, COMPLETE_MARKER), new Date().toISOString(), "utf-8");
    await fsp.rm(finalDir, { recursive: true, force: true });
    try {
      await fsp.rename(staging, finalDir);
    } catch (err) {
      if (!buildIsComplete(finalDir)) throw err;
    }
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
  }
}

/**
 * Make sure the provider's build exists. Returns its key, or null for a
 * provider with nothing to build (such as "None").
 */
export async function ensureCssProviderBuild(manifest: Record<string, unknown> | null): Promise<string | null> {
  const key = cssProviderBuildKey(manifest);
  if (!key || !manifest) return null;
  const finalDir = cssProviderBuildDir(key);
  if (!finalDir) return null;
  if (buildIsComplete(finalDir)) return key;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = buildQueue.then(() => buildInto(manifest, key, finalDir));
    buildQueue = pending.catch(() => undefined);
    inFlight.set(key, pending);
    void pending.finally(() => inFlight.delete(key)).catch(() => undefined);
  }
  await pending;
  return key;
}

/**
 * Directories the public /css-providers route may read from. Anything else in
 * the install directory is build scaffolding — package.json, package-lock.json,
 * and input.css, which is a build input rather than a published asset.
 */
const SERVABLE_ROOTS = ["node_modules", "dist"] as const;

/**
 * A file inside one provider build. `relativePath` starts with the build key,
 * as in the URLs resolveProviderAssets() publishes.
 */
export function resolveInstalledAssetPath(relativePath: string): string | null {
  const cleaned = relativePath.replace(/^\.?\//, "");
  const slash = cleaned.indexOf("/");
  if (slash <= 0) return null;
  const buildDir = cssProviderBuildDir(cleaned.slice(0, slash));
  if (!buildDir || !buildIsComplete(buildDir)) return null;
  const normalized = path
    .normalize(cleaned.slice(slash + 1))
    .replace(/^(\.\.(\/|\\|$))+/, "")
    .replace(/^node_modules[/\\]/, "");

  if (!normalized || path.isAbsolute(normalized)) return null;

  for (const root of SERVABLE_ROOTS) {
    const base = path.join(buildDir, root);
    // A manifest href may name the root explicitly ("dist/tailwind.css") or omit
    // it ("tailwindcss/tailwind.css", where resolveAssetUrl stripped
    // "node_modules/"), so try both against each root.
    const withoutRoot = normalized.startsWith(`${root}/`)
      ? normalized.slice(root.length + 1)
      : normalized;

    for (const candidate of new Set([withoutRoot, normalized])) {
      if (!candidate) continue;
      // resolvePathUnderBase appends the separator before comparing, so a
      // sibling directory cannot satisfy the check, and it resolves symlinks
      // so a link inside the package cannot point out of it.
      const resolved = resolvePathUnderBase(base, candidate);
      if (resolved && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return resolved;
      }
    }
  }
  return null;
}
