#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * Look for credentials committed to the tree.
 *
 * A leaked secret is the one supply-chain failure that pinning dependencies
 * does nothing about, and CI had no check for it. This runs over tracked files
 * rather than history: it is fast, and it catches the case that matters — a
 * secret about to be merged — rather than re-reporting one that already needs
 * rotating regardless.
 *
 * Node builtins only, so CI does not gain a dependency in order to check for
 * supply-chain problems.
 *
 * Exit 0 clean, 1 on a finding.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");

/**
 * Each rule is deliberately anchored on a provider's own key format rather than
 * on the word "secret", which is what makes a scanner useful instead of a
 * source of noise nobody reads.
 */
const RULES = [
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "AWS secret access key", re: /\baws_secret_access_key\s*=\s*['"]?[A-Za-z0-9/+=]{40}\b/i },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "GitHub fine-grained token", re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Stripe secret key", re: /\bsk_(live|test)_[A-Za-z0-9]{24,}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "OpenAI key", re: /\bsk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}\b/ },
  { name: "Anthropic key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: "npm token", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  {
    name: "JSON Web Token",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  { name: "private key block", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  {
    name: "populated secret assignment",
    // A real-looking value, not a placeholder. The negative lookahead is what
    // keeps .env.example and every "change-me" line out of the results.
    re: /\b(?:APP_SECRET|DB_PASSWORD|SMTP_PASS|JUSTFLOWS_UPDATE_SIGNING_KEY|JUSTFLOWS_INSTALL_TOKEN)\s*=\s*(?!\s*$)(?!['"]?(?:change|replace|your|example|test|placeholder|xxx|\.\.\.))['"]?[A-Za-z0-9/+=_-]{16,}/i,
  },
];

/** Paths whose whole purpose is to contain example or fixture material. */
const SKIP_PATHS = [
  /^\.env\.example$/,
  /^\.env\.production\.example$/,
  /(^|\/)scripts\/scan-secrets\.mjs$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)CHANGELOG\.md$/,
  /(^|\/)docs\//,
  /\.(png|jpg|jpeg|gif|webp|avif|ico|woff2?|mp4|webm|mp3|ogg|pdf|zip|gz)$/i,
];

/** A line carrying this marker is a reviewed exception. */
const ALLOW_MARKER = "scan-secrets:allow";

function trackedFiles() {
  const out = execFileSync("git", ["ls-files"], {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split("\n").filter(Boolean);
}

function main() {
  let files;
  try {
    files = trackedFiles();
  } catch {
    console.error("[scan-secrets] not a git checkout — nothing to scan");
    process.exit(0);
  }

  const findings = [];
  let scanned = 0;

  for (const rel of files) {
    if (SKIP_PATHS.some((re) => re.test(rel))) continue;

    const full = path.join(ROOT, rel);
    let text;
    try {
      const content = fs.readFileSync(full);
      if (content.length > 2 * 1024 * 1024) continue;
      text = content.toString("utf-8");
    } catch {
      continue;
    }
    // Skip binary content. A NUL byte is the reliable marker; reading a
    // compiled asset as UTF-8 produces noise rather than findings.
    if (text.includes("\u0000")) continue;

    scanned += 1;
    text.split("\n").forEach((line, i) => {
      if (line.includes(ALLOW_MARKER)) return;
      for (const rule of RULES) {
        if (rule.re.test(line)) {
          findings.push({ file: rel, line: i + 1, rule: rule.name });
          break;
        }
      }
    });
  }

  if (findings.length === 0) {
    console.log(`[scan-secrets] scanned ${scanned} of ${files.length} tracked files — clean`);
    process.exit(0);
  }

  console.error(
    `[scan-secrets] scanned ${scanned} files; ${findings.length} possible credential(s) committed:\n`,
  );
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.rule}`);
  }
  console.error(
    `\nRotate anything real — a secret in git is compromised even once removed,` +
      `\nbecause the object stays reachable in history and in every clone.` +
      `\nIf this is a fixture, add "${ALLOW_MARKER}" to the line.`,
  );
  process.exit(1);
}

main();
