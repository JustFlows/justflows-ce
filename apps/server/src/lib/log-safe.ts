// SPDX-License-Identifier: MIT

/**
 * Make a string safe to pass to `console.*`.
 *
 * Node treats the first argument as a util.format string, so a `%` in a request
 * path can consume the next argument (often the Error). CR/LF split or forge
 * log lines (CodeQL js/log-injection). The `\n`/`\r` replacements must be empty
 * strings — CodeQL only treats that as a sanitizer, not a substitute character.
 */
export function logSafe(value: string, maxLen = 256): string {
  return value.replace(/\n/g, "").replace(/\r/g, "").replace(/\t/g, "_").replace(/%/g, "_").slice(0, maxLen);
}
