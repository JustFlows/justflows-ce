// SPDX-License-Identifier: MIT

import type { FindingInput, Rule } from "../types.js";
import { filesMatching, finding, lineOf, matches, permissions, scannedCodeFiles, withoutComments } from "./util.js";

const NODE_MODULE = (names: string) => new RegExp(`(?:from\\s*|import\\s*\\(\\s*|require\\s*\\(\\s*)["'](?:node:)?(${names})(?:/[a-z]+)?["']`, "g");

/** Patterns of credentials that must never ship in a package. */
const SECRET_PATTERNS: ReadonlyArray<{ pattern: RegExp; what: string }> = [
  { pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g, what: "a private key" },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, what: "an AWS access key" },
  { pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/g, what: "a GitHub token" },
  { pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g, what: "a live Stripe key" },
  { pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, what: "a Slack token" },
  { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, what: "a Google API key" },
  { pattern: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}\b/g, what: "an AI provider API key" },
];

const SECRET_FILE = /(^|\/)(\.env(\.[^/]*)?|[^/]*\.(pem|key|p12|pfx|keystore|jks)|id_(rsa|ed25519|ecdsa)[^/]*|\.npmrc|\.pypirc)$/;
const TEXT_FILE = /\.(?:[cm]?js|jsx|tsx?|json|html?|css|md|txt|ya?ml|env|ini|cfg|conf)$/;

export const securityRules: Rule[] = [
  {
    id: "JF-S001",
    title: "No dynamic code evaluation",
    category: "security",
    severity: "error",
    check: (target) =>
      scannedCodeFiles(target).flatMap((file) => [
        ...matches(file, /\beval\s*\(/g).map(({ line }) => finding("eval() runs a string as code", file.path, line)),
        ...matches(file, /\bnew\s+Function\s*\(/g).map(({ line }) => finding("new Function() runs a string as code", file.path, line)),
        ...matches(file, /\bset(?:Timeout|Interval)\s*\(\s*["'`]/g).map(({ line }) => finding("A string passed to setTimeout/setInterval is evaluated as code", file.path, line)),
      ]),
  },
  {
    id: "JF-S002",
    title: "No process, filesystem, or raw network access outside the SDK",
    category: "security",
    severity: "error",
    types: ["plugin"],
    check: (target) => {
      const outbound = permissions(target).has("network:outbound");
      return scannedCodeFiles(target).flatMap((file): FindingInput[] => [
        ...matches(file, NODE_MODULE("child_process|vm|worker_threads|cluster")).map(({ match, line }) =>
          finding(`Imports "${match[1]}", which runs code outside the plugin sandbox the SDK provides`, file.path, line),
        ),
        ...matches(file, NODE_MODULE("fs|fs/promises")).map(({ line }) => ({
          ...finding("Imports the filesystem directly. Read only the plugin's own package files; store data with ctx.files or ctx.data", file.path, line),
          severity: "warning" as const,
        })),
        ...matches(file, NODE_MODULE("net|tls|dgram|http|https|http2")).map(({ match, line }) => ({
          ...finding(
            outbound
              ? `Imports "${match[1]}" directly; use ctx.outbound.fetch, which applies the host's SSRF guard`
              : `Imports "${match[1]}" without the "network:outbound" permission`,
            file.path,
            line,
          ),
          ...(outbound ? { severity: "warning" as const } : {}),
        })),
        ...matches(file, /\bprocess\.env\b/g).map(({ line }) => ({
          ...finding("Reads process.env, which holds the installation's secrets; use plugin settings or secrets", file.path, line),
          severity: "warning" as const,
        })),
      ]);
    },
  },
  {
    id: "JF-S003",
    title: "No SQL built from interpolated strings",
    category: "security",
    severity: "error",
    check: (target) =>
      scannedCodeFiles(target).flatMap((file) =>
        matches(file, /\.(?:query|run|execute|raw|unsafe)\s*\(\s*`(?:[^`\\]|\\.)*\$\{/g).map(({ line }) =>
          finding("SQL built with ${...}; pass values as parameters (?) instead", file.path, line),
        ),
      ),
  },
  {
    id: "JF-S004",
    title: "No unsanitized HTML output",
    category: "security",
    severity: "warning",
    check: (target) => {
      const browserFiles = [...scannedCodeFiles(target), ...filesMatching(target, /\.html?$/)];
      return browserFiles.flatMap((file) => [
        ...matches(file, /\.(?:innerHTML|outerHTML)\s*\+?=(?!=)/g).map(({ line }) => finding("Assigns innerHTML/outerHTML; sanitize the value or use textContent", file.path, line)),
        ...matches(file, /\.insertAdjacentHTML\s*\(|document\.write(?:ln)?\s*\(/g).map(({ line }) => finding("Writes raw HTML into the page; sanitize the value first", file.path, line)),
        ...matches(file, /dangerouslySetInnerHTML/g).map(({ line }) => finding("dangerouslySetInnerHTML; sanitize the value with the SDK sanitizers", file.path, line)),
      ]);
    },
  },
  {
    id: "JF-S005",
    title: "No secrets or key files in the package",
    category: "security",
    severity: "error",
    check: (target) => {
      const out: FindingInput[] = target.files.filter((file) => SECRET_FILE.test(file.path)).map((file) => finding("This file holds credentials and must not ship", file.path));
      for (const file of target.files) {
        if (!TEXT_FILE.test(file.path) && !/(^|\/)\.[a-z]+$/.test(file.path)) continue;
        const text = file.text();
        for (const { pattern, what } of SECRET_PATTERNS) {
          pattern.lastIndex = 0;
          const match = pattern.exec(text);
          if (match) out.push(finding(`Contains what looks like ${what}`, file.path, lineOf(text, match.index)));
        }
      }
      return out;
    },
  },
  {
    id: "JF-S006",
    title: "HTML works under the Content Security Policy",
    category: "security",
    severity: "error",
    check: (target) =>
      filesMatching(target, /\.html?$/).flatMap((file) => {
        const text = withoutComments(file.text()).replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, " "));
        const out: FindingInput[] = [];
        for (const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
          const attrs = match[1] ?? "";
          const body = (match[2] ?? "").trim();
          const isData = /type\s*=\s*["']?(application\/(?:ld\+)?json|importmap)/i.test(attrs);
          if (!/\bsrc\s*=/.test(attrs) && body && !isData) out.push(finding("Inline <script>; the CSP blocks it. Move it to a file and load it with src", file.path, lineOf(text, match.index ?? 0)));
        }
        for (const match of text.matchAll(/<[a-z][^>]*\s(on[a-z]+)\s*=/gi)) {
          out.push(finding(`Inline event handler ${match[1]}=; the CSP blocks it. Attach the listener from a script file`, file.path, lineOf(text, match.index ?? 0)));
        }
        for (const match of text.matchAll(/(?:href|src)\s*=\s*["']\s*javascript:/gi)) {
          out.push(finding("javascript: URL; the CSP blocks it", file.path, lineOf(text, match.index ?? 0)));
        }
        return out;
      }),
  },
  {
    id: "JF-S007",
    title: "No code loaded from remote origins",
    category: "security",
    severity: "error",
    check: (target) => [
      ...filesMatching(target, /\.html?$/).flatMap((file) =>
        matches(file, /<script\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//gi).map(({ line }) => finding("Loads a script from another origin; ship it in the package", file.path, line)),
      ),
      ...scannedCodeFiles(target).flatMap((file) =>
        matches(file, /\bimport\s*\(\s*["'`]https?:/g).map(({ line }) => finding("Imports code from a URL at run time", file.path, line)),
      ),
    ],
  },
  {
    id: "JF-S008",
    title: "Routes that change data check who is calling",
    category: "security",
    severity: "warning",
    types: ["plugin"],
    check: (target) =>
      scannedCodeFiles(target).flatMap((file) => {
        const writes = matches(file, /\.http\.(post|put|patch|delete)\s*\(/g);
        if (writes.length === 0) return [];
        const text = withoutComments(file.text());
        if (/\bsession\b/.test(text) || /capabilit/i.test(text)) return [];
        return [finding(`${writes.length} route${writes.length === 1 ? "" : "s"} that change data, but this file never reads req.session or a capability`, file.path, writes[0]!.line)];
      }),
  },
];
