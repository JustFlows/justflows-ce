// SPDX-License-Identifier: MIT

import type { Rule } from "../types.js";
import { manifestRules } from "./manifest.js";
import { packagingRules } from "./packaging.js";
import { permissionRules } from "./permissions.js";
import { securityRules } from "./security.js";
import { themeRules } from "./theme.js";

/**
 * The built-in rules. A rule id is never reused for a different check;
 * changing what a rule reports bumps RULESET_VERSION.
 */
export const DEFAULT_RULES: readonly Rule[] = [...manifestRules, ...permissionRules, ...securityRules, ...packagingRules, ...themeRules];
