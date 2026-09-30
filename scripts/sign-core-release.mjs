#!/usr/bin/env node
// SPDX-License-Identifier: MIT

// Sign a core release archive so installed sites accept it as an update.
//
//   node scripts/sign-core-release.mjs justflows.zip
//     Writes justflows.zip.sig. The private key comes from
//     JUSTFLOWS_CORE_RELEASE_KEY_FILE (path to a PEM file) or
//     JUSTFLOWS_CORE_RELEASE_KEY (the PEM itself). The version is read from the
//     archive's package.json; pass --version to override.
//
//   node scripts/sign-core-release.mjs --generate-key path/to/private.pem
//     Creates a new Ed25519 key pair, writes the private key (mode 600) and
//     prints the public key to paste into CORE_RELEASE_PUBLIC_KEYS in
//     apps/server/src/lib/extensions/package-trust.ts.
//
// The signature covers "justflows-core\n<version>\n<sha256 hex>" — see
// coreReleaseSignPayload in package-trust.ts. Keep the two in sync.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function fail(message) {
  console.error(`sign-core-release: ${message}`);
  process.exit(1);
}

function payload(version, digestHex) {
  return Buffer.from(`justflows-core\n${version}\n${digestHex.toLowerCase()}`, "utf8");
}

/**
 * Read the version from the exact bytes being signed. `unzip` needs a file, so
 * it gets a private copy of `zipBytes` rather than the original path, which
 * could change between reading the version and hashing the archive.
 */
function readVersionFromZip(zipBytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jf-sign-"));
  try {
    const copy = path.join(dir, "archive.zip");
    fs.writeFileSync(copy, zipBytes, { mode: 0o600, flag: "wx" });
    for (const entry of ["package.json", "justflows/package.json"]) {
      try {
        const raw = execFileSync("unzip", ["-p", copy, entry], {
          stdio: ["ignore", "pipe", "ignore"],
        });
        if (raw.length === 0) continue;
        const pkg = JSON.parse(raw.toString("utf8"));
        if (pkg.name === "justflows" && typeof pkg.version === "string") return pkg.version;
      } catch {
        /* try the next location */
      }
    }
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function loadPrivateKey() {
  const file = process.env.JUSTFLOWS_CORE_RELEASE_KEY_FILE;
  const pem = file ? fs.readFileSync(file, "utf8") : process.env.JUSTFLOWS_CORE_RELEASE_KEY;
  if (!pem) fail("set JUSTFLOWS_CORE_RELEASE_KEY_FILE or JUSTFLOWS_CORE_RELEASE_KEY");
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") fail("the release key must be an Ed25519 private key");
  return key;
}

const args = process.argv.slice(2);

if (args[0] === "--generate-key") {
  const out = args[1];
  if (!out) fail("usage: --generate-key <private-key.pem>");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  try {
    // "wx" creates the file or fails if it exists, in one step.
    fs.writeFileSync(out, privateKey.export({ type: "pkcs8", format: "pem" }), {
      mode: 0o600,
      flag: "wx",
    });
  } catch (err) {
    if (err?.code === "EEXIST") fail(`${out} already exists; refusing to overwrite a key`);
    throw err;
  }
  console.log(`Private key written to ${out}. Keep it out of every repository.\n`);
  console.log("Public key for CORE_RELEASE_PUBLIC_KEYS:\n");
  console.log(publicKey.export({ type: "spki", format: "pem" }).toString().trim());
  process.exit(0);
}

const versionFlag = args.indexOf("--version");
const explicitVersion = versionFlag >= 0 ? args[versionFlag + 1] : null;
const zipPath = args.find(
  (a, i) => !a.startsWith("--") && (versionFlag < 0 || i !== versionFlag + 1),
);
if (!zipPath) fail("usage: sign-core-release.mjs <justflows.zip> [--version X.Y.Z]");

// Read the archive once; the digest and the version both come from these bytes.
let zipBytes;
try {
  zipBytes = fs.readFileSync(zipPath);
} catch (err) {
  fail(err?.code === "ENOENT" ? `${zipPath} not found` : `cannot read ${zipPath}: ${err?.message}`);
}

const version = explicitVersion ?? readVersionFromZip(zipBytes);
if (!version) fail("could not read the version from the archive's package.json; pass --version");

const digest = createHash("sha256").update(zipBytes).digest("hex");
const privateKey = loadPrivateKey();
const signature = sign(null, payload(version, digest), privateKey);

// Check the signature against the key's own public half before publishing it.
const publicKey = createPublicKey(privateKey);
if (!verify(null, payload(version, digest), publicKey, signature)) fail("self-check failed");

fs.writeFileSync(`${zipPath}.sig`, `${signature.toString("base64")}\n`);
console.log(`Signed ${zipPath} (v${version}, sha256 ${digest.slice(0, 12)}…) -> ${zipPath}.sig`);
