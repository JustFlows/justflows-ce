#!/usr/bin/env node
/**
 * Bundle apps/server/dist into one file for faster cold boot on shared hosting.
 * Workspace packages (@justflows/*) are inlined so Passenger can boot before
 * `node_modules/@justflows/core` exists. npm packages stay external.
 *
 * Do not use esbuild `packages: "external"` here — it marks every package
 * import as external after plugins run, so `external: false` cannot inline
 * `@justflows/*`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "apps/server/dist/server.js");
const outfile = path.join(root, "apps/server/dist/server.bundle.mjs");

if (!fs.existsSync(entry)) {
  console.error("[bundle-server] Missing apps/server/dist/server.js — run build:server first.");
  process.exit(1);
}

function isBareSpecifier(id) {
  return !(id.startsWith(".") || id.startsWith("/") || path.isAbsolute(id) || id.startsWith("file:"));
}

const esbuild = await import("esbuild");

const result = await esbuild.build({
  absWorkingDir: root,
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  logLevel: "info",
  plugins: [
    {
      name: "external-non-workspace",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === "entry-point") return;
          if (args.path.startsWith("@justflows/")) return;
          if (!isBareSpecifier(args.path)) return;
          return { path: args.path, external: true };
        });
      },
    },
  ],
});

if (result.errors.length) process.exit(1);

const out = fs.readFileSync(outfile, "utf8");
if (/(?:from|import)\s*\(?\s*["']@justflows\//.test(out)) {
  console.error("[bundle-server] Bundle still imports @justflows/* as external. Passenger cannot boot this file.");
  process.exit(1);
}

/**
 * A package that starts a worker finds its file with
 * `new URL("./x.mjs", import.meta.url)`. Inside the bundle that URL points
 * next to `server.bundle.mjs`, so those plain `.mjs` modules (the installer's
 * archive worker) are copied there. Two packages may not ship the same name.
 */
const outDir = path.dirname(outfile);
const copied = new Map();
for (const pkg of fs.readdirSync(path.join(root, "packages"))) {
  const src = path.join(root, "packages", pkg, "src");
  if (!fs.existsSync(src)) continue;
  for (const name of fs.readdirSync(src)) {
    if (!name.endsWith(".mjs") || name.includes(".test.")) continue;
    if (copied.has(name)) {
      console.error(`[bundle-server] ${name} is shipped by both ${copied.get(name)} and ${pkg}.`);
      process.exit(1);
    }
    fs.copyFileSync(path.join(src, name), path.join(outDir, name));
    copied.set(name, pkg);
  }
}

console.log("[bundle-server] Wrote", path.relative(root, outfile));
if (copied.size) console.log("[bundle-server] Copied", [...copied.keys()].join(", "));
