#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * Emit a CycloneDX 1.5 SBOM for the production dependency tree.
 *
 * Releases ship as a zip a self-hoster uploads by FTP. Without a bill of
 * materials, nobody downstream can answer "does this contain the package in
 * today's advisory?" without unpacking it and reading a lockfile — and that is
 * the question that gets asked in the hour after a disclosure.
 *
 * Reads package-lock.json, which make-zip.sh generates immediately before this
 * runs, so the SBOM describes exactly what the archive carries rather than what
 * the workspace happens to have installed. Node builtins only.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");

/** npm integrity ("sha512-<base64>") to the CycloneDX hash shape. */
function toCycloneHash(integrity) {
  if (typeof integrity !== "string") return null;
  const [alg, b64] = integrity.split("-");
  const alias = { sha1: "SHA-1", sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512" }[alg];
  if (!alias || !b64) return null;
  return { alg: alias, content: Buffer.from(b64, "base64").toString("hex") };
}

/** Package URL for an npm component, scope preserved and encoded. */
function purl(name, version) {
  if (name.startsWith("@")) {
    const [scope, bare] = name.slice(1).split("/");
    return `pkg:npm/%40${encodeURIComponent(scope)}/${encodeURIComponent(bare)}@${version}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${version}`;
}

function main() {
  const outPath = process.argv[2] ?? path.join(ROOT, "sbom.cdx.json");
  const lockPath = path.join(ROOT, "package-lock.json");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));

  if (!fs.existsSync(lockPath)) {
    console.error("[sbom] package-lock.json not found — run npm install --package-lock-only first");
    process.exit(1);
  }

  const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
  const components = [];
  const seen = new Set();

  for (const [location, entry] of Object.entries(lock.packages ?? {})) {
    // "" is the root project, not a dependency of itself.
    if (!location) continue;
    // The archive ships production dependencies only.
    if (entry.dev || entry.optional) continue;

    const name = entry.name ?? location.split("node_modules/").pop();
    if (!name || !entry.version) continue;

    const key = `${name}@${entry.version}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const component = {
      type: "library",
      "bom-ref": purl(name, entry.version),
      name,
      version: entry.version,
      purl: purl(name, entry.version),
      scope: "required",
    };
    if (entry.license) component.licenses = [{ license: { id: entry.license } }];
    if (entry.resolved) {
      component.externalReferences = [{ type: "distribution", url: entry.resolved }];
    }
    const hash = toCycloneHash(entry.integrity);
    if (hash) component.hashes = [hash];

    components.push(component);
  }

  components.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

  const bom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    // Deterministic: derived from the content, so rebuilding the same commit
    // produces the same document rather than a new random urn each time.
    serialNumber: `urn:uuid:${uuidFrom(`${pkg.name}@${pkg.version}:${components.length}`)}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: "Justflows", name: "generate-sbom", version: "1.0.0" }],
      component: {
        type: "application",
        "bom-ref": purl(pkg.name, pkg.version),
        name: pkg.name,
        version: pkg.version,
        purl: purl(pkg.name, pkg.version),
        licenses: pkg.license ? [{ license: { id: pkg.license } }] : undefined,
      },
    },
    components,
  };

  fs.writeFileSync(outPath, `${JSON.stringify(bom, null, 2)}\n`, "utf-8");
  console.log(`[sbom] ${components.length} production components -> ${path.relative(ROOT, outPath)}`);
}

/** A stable UUIDv5-shaped identifier derived from a string. */
function uuidFrom(input) {
  const h = createHash("sha1").update(input).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `5${h.slice(13, 16)}`,
    ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + h.slice(18, 20),
    h.slice(20, 32),
  ].join("-");
}

main();
