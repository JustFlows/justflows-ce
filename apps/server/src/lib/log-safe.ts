// SPDX-License-Identifier: MIT

/**
 * Make a string safe to pass to `console.*`.
 *
 * Node treats the first argument as a util.format string, so a `%` in a request
 * path can consume the next argument (often the Error). CR/LF/TAB split or
 * forge log lines (CodeQL js/log-injection).
 */
export function logSafe(value: string, maxLen = 256): string {
  return value.replace(/[\r\n\t%]/g, "_").slice(0, maxLen);
}
