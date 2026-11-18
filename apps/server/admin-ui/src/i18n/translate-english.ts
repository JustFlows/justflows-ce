// SPDX-License-Identifier: MIT
import { EMBEDDED_EN } from "./embedded-en";
import { interpolate, lookupMessage, type Translate } from "./translate";

/**
 * English default for pure helpers; UI callers pass their active translator.
 * Its own module so the bundled English catalog stays out of the admin's
 * initial load: only the pages and helpers that use it pull it in.
 */
export const translateEnglish: Translate = (key, vars) =>
  interpolate(lookupMessage(EMBEDDED_EN, key, "en", vars) ?? key, vars);
