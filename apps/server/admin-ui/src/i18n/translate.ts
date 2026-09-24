// SPDX-License-Identifier: MIT
import { EMBEDDED_EN } from "./embedded-en";

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function interpolate(message: string, vars?: Record<string, string | number>): string {
  if (!vars) return message;
  // Replace once, so values containing another placeholder remain literal data.
  return message.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/** English default for pure helpers; UI callers pass their active translator. */
export const translateEnglish: Translate = (key, vars) =>
  interpolate(EMBEDDED_EN[key] ?? key, vars);
