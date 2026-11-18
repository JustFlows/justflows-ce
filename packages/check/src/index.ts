// SPDX-License-Identifier: MIT

export {
  BASELINE_FILE,
  baselineFor,
  checkPackage,
  exitCode,
  formatText,
  helpUrl,
  readBaseline,
  runRules,
  RULESET_VERSION,
  type CheckOptions,
} from "./check.js";
export { loadTarget } from "./load.js";
export { DEFAULT_RULES } from "./rules/index.js";
export { API_PERMISSIONS } from "./rules/permissions.js";
export type {
  BaselineEntry,
  CheckTarget,
  Finding,
  FindingInput,
  PackageFile,
  PackageType,
  Report,
  Rule,
  RuleCategory,
  Severity,
} from "./types.js";
