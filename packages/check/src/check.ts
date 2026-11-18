// SPDX-License-Identifier: MIT

import fs from "node:fs";
import path from "node:path";
import { loadTarget } from "./load.js";
import { DEFAULT_RULES } from "./rules/index.js";
import type { BaselineEntry, CheckTarget, Finding, Report, Rule, Severity } from "./types.js";

/** Version of the rule set; reported with every result so a CI gate can pin it. */
export const RULESET_VERSION = "1.0.0";
export const BASELINE_FILE = ".justflows-check.json";
const HELP_BASE = "https://github.com/JustFlows/justflows-ce/blob/main/docs/EXTENSION-CHECKER.md";

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function helpUrl(ruleId: string): string {
  return `${HELP_BASE}#${ruleId.toLowerCase()}`;
}

export interface CheckOptions {
  /** Rules to run instead of the defaults. */
  rules?: readonly Rule[];
  /** Rules added after the defaults, e.g. registry-specific checks. */
  extraRules?: readonly Rule[];
  /** Justflows version to check compatibility against; null skips that check. */
  coreVersion?: string | null;
  /** Accepted findings. Defaults to `.justflows-check.json` in a package folder. */
  baseline?: BaselineEntry[];
  /** Treat a folder as an unpacked package, such as an installed extension. */
  asPackage?: boolean;
}

export function readBaseline(file: string): BaselineEntry[] {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { ignore?: unknown };
  if (!Array.isArray(parsed.ignore)) throw new Error(`${file} must have an "ignore" array`);
  return parsed.ignore.filter((entry): entry is BaselineEntry => Boolean(entry) && typeof (entry as BaselineEntry).rule === "string");
}

export function baselineFor(findings: Finding[]): { version: 1; ignore: BaselineEntry[] } {
  const seen = new Set<string>();
  const ignore: BaselineEntry[] = [];
  for (const item of findings) {
    const key = `${item.rule}|${item.file ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ignore.push({ rule: item.rule, ...(item.file ? { file: item.file } : {}), reason: "accepted" });
  }
  return { version: 1, ignore };
}

function suppressed(item: Finding, baseline: BaselineEntry[]): boolean {
  return baseline.some((entry) => entry.rule === item.rule && (!entry.file || entry.file === item.file));
}

/** Run rules against an already-loaded package. */
export function runRules(target: CheckTarget, options: Omit<CheckOptions, "coreVersion"> = {}): { findings: Finding[]; suppressed: Finding[] } {
  const rules = [...(options.rules ?? DEFAULT_RULES), ...(options.extraRules ?? [])];
  const all: Finding[] = [];
  for (const rule of rules) {
    if (rule.types && (!target.type || !rule.types.includes(target.type))) continue;
    let results;
    try {
      results = rule.check(target);
    } catch (error) {
      results = [{ message: `The rule could not run: ${error instanceof Error ? error.message : String(error)}`, severity: "warning" as const }];
    }
    for (const result of results) {
      const { severity, ...rest } = result;
      all.push({ rule: rule.id, severity: severity ?? rule.severity, category: rule.category, ...rest, help: helpUrl(rule.id) });
    }
  }
  all.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.rule.localeCompare(b.rule) ||
      (a.file ?? "").localeCompare(b.file ?? "") ||
      (a.line ?? 0) - (b.line ?? 0),
  );
  const baseline = options.baseline ?? [];
  return { findings: all.filter((item) => !suppressed(item, baseline)), suppressed: all.filter((item) => suppressed(item, baseline)) };
}

/** Check a package folder or a .jfpkg archive. */
export async function checkPackage(input: string, options: CheckOptions = {}): Promise<Report> {
  const loaded = await loadTarget(input, { coreVersion: options.coreVersion, asPackage: options.asPackage });
  try {
    const { target } = loaded;
    let baseline = options.baseline;
    if (!baseline && target.mode === "source") {
      const file = path.join(target.root, BASELINE_FILE);
      if (fs.existsSync(file)) baseline = readBaseline(file);
    }
    const result = runRules(target, { ...options, baseline: baseline ?? [] });
    const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
    for (const item of result.findings) counts[item.severity] += 1;
    return {
      tool: "justflows-check",
      rulesetVersion: RULESET_VERSION,
      target: {
        path: path.resolve(input),
        mode: target.mode,
        type: target.type,
        id: typeof target.manifest?.id === "string" ? target.manifest.id : null,
        version: typeof target.manifest?.version === "string" ? target.manifest.version : null,
      },
      coreVersion: target.coreVersion,
      ...result,
      counts,
    };
  } finally {
    await loaded.dispose();
  }
}

/** Exit code for CI: 1 when any finding reaches `failOn`, else 0. */
export function exitCode(report: Report, failOn: Severity = "error"): 0 | 1 {
  return report.findings.some((item) => SEVERITY_ORDER[item.severity] <= SEVERITY_ORDER[failOn]) ? 1 : 0;
}

/** A human-readable report, most severe first. */
export function formatText(report: Report): string {
  const lines: string[] = [];
  const name = report.target.id ? `${report.target.id} ${report.target.version ?? ""}`.trim() : report.target.path;
  lines.push(`justflows check ${name} (${report.target.type ?? "unknown type"}, ${report.target.mode}, rules ${report.rulesetVersion})`);
  if (report.findings.length === 0) lines.push("", "No problems found.");
  for (const item of report.findings) {
    const where = item.file ? `${item.file}${item.line ? `:${item.line}` : ""}` : "";
    lines.push("", `${item.severity.toUpperCase().padEnd(7)} ${item.rule}  ${item.message}`);
    if (where) lines.push(`        ${where}`);
    lines.push(`        ${item.help}`);
  }
  lines.push(
    "",
    `${report.counts.error} error${report.counts.error === 1 ? "" : "s"}, ${report.counts.warning} warning${report.counts.warning === 1 ? "" : "s"}, ${report.counts.info} note${report.counts.info === 1 ? "" : "s"}` +
      (report.suppressed.length ? `, ${report.suppressed.length} accepted by the baseline` : ""),
  );
  return lines.join("\n");
}
