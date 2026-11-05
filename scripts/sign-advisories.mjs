#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * Sign the security advisory feed.
 *
 *   node scripts/sign-advisories.mjs advisories.json out.json --sequence 12 [--days 30]
 *
 * advisories.json is a JSON array of advisories. See docs/SECURITY-ADVISORIES.md.
 * The private key comes from JUSTFLOWS_CORE_RELEASE_KEY_FILE (path to a PEM file)
 * or JUSTFLOWS_CORE_RELEASE_KEY (the PEM itself).
 *
 * The signature covers "justflows-advisories\n<sha256 hex of payload>". See
 * advisorySignPayload in security-advisories.ts. Keep the two in sync.
 */

import { createHash, createPrivateKey, sign } from "node:crypto";
import fs from "node:fs";

function fail(message) {
  console.error(`sign-advisories: ${message}`);
  process.exit(1);
}

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const [input, output] = process.argv.slice(2);
if (!input || !output || input.startsWith("--") || output.startsWith("--")) {
  fail("usage: sign-advisories.mjs <advisories.json> <out.json> --sequence <n> [--days 30]");
}

const sequence = Number(option("sequence"));
const days = Number(option("days", "30"));
if (!Number.isSafeInteger(sequence) || sequence < 0) fail("--sequence must be a whole number");
if (!Number.isFinite(days) || days <= 0 || days > 90) fail("--days must be between 1 and 90");

const file = process.env.JUSTFLOWS_CORE_RELEASE_KEY_FILE;
const pem = file ? fs.readFileSync(file, "utf8") : process.env.JUSTFLOWS_CORE_RELEASE_KEY;
if (!pem) fail("set JUSTFLOWS_CORE_RELEASE_KEY_FILE or JUSTFLOWS_CORE_RELEASE_KEY");

const advisories = JSON.parse(fs.readFileSync(input, "utf8"));
if (!Array.isArray(advisories)) fail("advisories.json must be a JSON array");

const issuedAt = new Date();
const expiresAt = new Date(issuedAt.getTime() + days * 24 * 60 * 60 * 1000);
const payload = JSON.stringify({
  sequence,
  issuedAt: issuedAt.toISOString(),
  expiresAt: expiresAt.toISOString(),
  advisories,
});
const digest = createHash("sha256").update(payload, "utf8").digest("hex");
const message = Buffer.from(`justflows-advisories\n${digest}`, "utf8");
const signature = sign(null, message, createPrivateKey(pem)).toString("base64");

fs.writeFileSync(output, `${JSON.stringify({ payload, signature })}\n`, "utf8");
console.log(`Signed ${advisories.length} advisories, sequence ${sequence}, expires ${expiresAt.toISOString()}`);
