#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * Check a CycloneDX SBOM before it ships with a release.
 *
 *   node scripts/verify-sbom.mjs sbom.cdx.json
 *
 * Operators read the SBOM in the hour after a disclosure, so an empty or stale
 * document is worse than none: it answers "not affected" for the wrong reason.
 * This checks that it describes this version and names every direct dependency
 * in the lockfile. It does not prove the components are safe.
 *
 * Node builtins only. Exit 0 clean, 1 on a problem.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every problem with a parsed SBOM, or an empty list.
 *
 * @param {unknown} bom Parsed SBOM document.
 * @param {{ name: string, version: string, directDependencies: string[] }} expected
 * @returns {string[]}
 */
export function sbomProblems(bom, expected) {
  if (!bom || typeof bom !== "object") return ["document is not a JSON object"];
  const problems = [];
  if (bom.bomFormat !== "CycloneDX") problems.push("bomFormat is not CycloneDX");
  if (typeof bom.specVersion !== "string") problems.push("specVersion is missing");

  const subject = bom.metadata?.component;
  if (subject?.name !== expected.name) {
    problems.push(`describes ${subject?.name ?? "nothing"}, not ${expected.name}`);
  }
  if (subject?.version !== expected.version) {
    problems.push(`describes version ${subject?.version ?? "none"}, not ${expected.version}`);
  }

  const components = Array.isArray(bom.components) ? bom.components : [];
  if (components.length === 0) problems.push("lists no components");
  for (const component of components) {
    if (!component?.name || !component?.version || !component?.purl) {
      problems.push(`incomplete component: ${component?.name ?? "unnamed"}`);
    }
  }

  const names = new Set(components.map((component) => component?.name));
  for (const dependency of expected.directDependencies) {
    if (!names.has(dependency)) problems.push(`missing direct dependency: ${dependency}`);
  }
  return problems;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function main() {
  const sbomPath = process.argv[2] ?? path.join(ROOT, "sbom.cdx.json");
  const pkg = readJson(path.join(ROOT, "package.json"));
  const lock = readJson(path.join(ROOT, "package-lock.json"));
  const problems = sbomProblems(readJson(sbomPath), {
    name: pkg.name,
    version: pkg.version,
    directDependencies: Object.keys(lock.packages?.[""]?.dependencies ?? {}),
  });
  if (problems.length > 0) {
    console.error(`[verify-sbom] ${sbomPath} failed:`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log(`[verify-sbom] ${sbomPath} ok`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
