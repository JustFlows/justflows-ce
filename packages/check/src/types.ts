// SPDX-License-Identifier: MIT

export type Severity = "error" | "warning" | "info";
export type PackageType = "plugin" | "theme" | "css-provider";
export type RuleCategory =
  | "manifest"
  | "permissions"
  | "compatibility"
  | "security"
  | "packaging"
  | "theme"
  | "accessibility";

/** The manifest fields rules read; anything else stays reachable by key. */
export interface ManifestShape {
  [key: string]: unknown;
  id?: unknown;
  type?: unknown;
  version?: unknown;
  license?: unknown;
  engines?: unknown;
  justflows?: unknown;
  entrypoints?: unknown;
  entrypoint?: unknown;
  assets?: unknown;
  adminApp?: unknown;
  adminMenu?: unknown;
  setupPath?: unknown;
  contentTypes?: unknown;
  patterns?: unknown;
  permissions?: unknown;
  scripts?: unknown;
}

export interface PackageJsonShape {
  [key: string]: unknown;
  version?: unknown;
  type?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
}

/** One file of the package being checked, read lazily. */
export interface PackageFile {
  /** Path relative to the package root, with forward slashes. */
  path: string;
  size: number;
  read(): Buffer;
  /** UTF-8 text, or "" for files too large to scan. */
  text(): string;
}

/** Everything a rule may inspect. */
export interface CheckTarget {
  /** Absolute path of the folder that was checked (an extracted copy for a .jfpkg). */
  root: string;
  /** "package" for a built .jfpkg, "source" for an author's working folder. */
  mode: "source" | "package";
  files: PackageFile[];
  /** Files left out of scanning because they belong to dependencies (source mode). */
  skippedDependencyFiles: number;
  manifest: ManifestShape | null;
  manifestError: string | null;
  type: PackageType | null;
  /** `justflows-theme.json`, when the package has one. */
  themeManifest: ManifestShape | null;
  packageJson: PackageJsonShape | null;
  /** The Justflows version compatibility is checked against, when known. */
  coreVersion: string | null;
  sdkVersion: string;
}

export interface Finding {
  rule: string;
  severity: Severity;
  category: RuleCategory;
  message: string;
  file?: string;
  line?: number;
  /** Where the rule is documented. */
  help: string;
}

export type FindingInput = Omit<Finding, "rule" | "severity" | "category" | "help"> & { severity?: Severity };

export interface Rule {
  /** Stable id such as JF-S001. Never reused for a different check. */
  id: string;
  title: string;
  category: RuleCategory;
  severity: Severity;
  /** Package types the rule applies to; all types when omitted. */
  types?: PackageType[];
  check(target: CheckTarget): FindingInput[];
}

export interface BaselineEntry {
  rule: string;
  file?: string;
  reason?: string;
}

export interface Report {
  tool: "justflows-check";
  rulesetVersion: string;
  target: { path: string; mode: CheckTarget["mode"]; type: PackageType | null; id: string | null; version: string | null };
  coreVersion: string | null;
  findings: Finding[];
  /** Findings accepted by the baseline file. */
  suppressed: Finding[];
  counts: Record<Severity, number>;
}
