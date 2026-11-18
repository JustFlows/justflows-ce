// SPDX-License-Identifier: MIT

import type { CheckTarget, FindingInput, PackageFile } from "../types.js";

const CODE_FILE = /\.(?:[cm]?js|jsx|tsx?)$/;
/** A file under a tests folder, or named *.test.* / *.spec.*. */
const TEST_DIR = /(?:^|\/)(?:tests?|__tests__)\//;
const TEST_SUFFIX = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
function isTestFile(filePath: string): boolean {
  return TEST_DIR.test(filePath) || TEST_SUFFIX.test(filePath);
}

/** Build tooling in an author's folder: it runs on their machine, not in the host. */
const TOOLING_FILE = /^(?:scripts|tools|bin|\.github)\/|(?:^|\/)[^/]*\.config\.[cm]?[jt]s$|(?:^|\/)(?:vite|rollup|webpack|esbuild|eslint|vitest|tsup)\.[^/]*$/;

/** JavaScript and TypeScript files that ship or build into the package, without tests and type declarations. */
function files_(target: CheckTarget): PackageFile[] {
  return target.mode === "source" ? target.files.filter((file) => !TOOLING_FILE.test(file.path)) : target.files;
}

export function codeFiles(target: CheckTarget): PackageFile[] {
  return files_(target).filter((file) => CODE_FILE.test(file.path) && !file.path.endsWith(".d.ts") && !isTestFile(file.path));
}

/** In source mode, `dist/` is a build of `src/`; scan both only when there is no source. */
export function scannedCodeFiles(target: CheckTarget): PackageFile[] {
  const files = codeFiles(target);
  if (target.mode === "package") return files;
  const hasSource = files.some((file) => file.path.startsWith("src/"));
  return hasSource ? files.filter((file) => !file.path.startsWith("dist/")) : files;
}

export function filesMatching(target: CheckTarget, pattern: RegExp): PackageFile[] {
  return target.files.filter((file) => pattern.test(file.path));
}

/**
 * Blank out comments, keeping line breaks so line numbers stay right. Strings
 * are left as they are: a regex-level scan, not a parser.
 */
export function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (match, lead: string) => lead + " ".repeat(match.length - lead.length));
}

export function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/** Every match of `pattern` (which must be global) in the file's code, with its line. */
export function matches(file: PackageFile, pattern: RegExp): Array<{ match: RegExpExecArray; line: number }> {
  const text = withoutComments(file.text());
  const found: Array<{ match: RegExpExecArray; line: number }> = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    found.push({ match, line: lineOf(text, match.index) });
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  return found;
}

export function manifestArray(target: CheckTarget, key: string): unknown[] {
  const value = target.manifest?.[key];
  return Array.isArray(value) ? value : [];
}

export function permissions(target: CheckTarget): Set<string> {
  return new Set(manifestArray(target, "permissions").filter((item): item is string => typeof item === "string"));
}

export function finding(message: string, file?: string, line?: number): FindingInput {
  return { message, ...(file ? { file } : {}), ...(line ? { line } : {}) };
}
