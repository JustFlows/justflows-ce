// SPDX-License-Identifier: MIT

import fs from "node:fs";
import path from "node:path";
import {
  BASELINE_FILE,
  baselineFor,
  checkPackage,
  DEFAULT_RULES,
  exitCode,
  formatText,
  readBaseline,
  type BaselineEntry,
  type Severity,
} from "@justflows/check";

export const CHECK_HELP = `
Usage: justflows check <folder | package.jfpkg> [options]

Checks a plugin, theme, or CSS provider for manifest, permission,
compatibility, security, packaging, and accessibility problems.

Options:
  --json                 Print the report as JSON
  --fail-on <level>      Exit with 1 at this severity or worse: error (default), warning, info
  --baseline <file>      Accept the findings listed in this file (default: ${BASELINE_FILE} in the folder)
  --write-baseline       Write every current finding to the baseline file and exit 0
  --core <version>       Check compatibility against this Justflows version
  --rules                List every rule and exit

Exit codes: 0 no blocking findings, 1 blocking findings, 2 the check could not run.
`.trim();

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function checkCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(CHECK_HELP);
    return;
  }
  if (args.includes("--rules")) {
    for (const rule of DEFAULT_RULES) console.log(`${rule.id.padEnd(8)} ${rule.severity.padEnd(8)} ${rule.category.padEnd(14)} ${rule.title}`);
    return;
  }
  const valueFlags = new Set(["--fail-on", "--baseline", "--core"]);
  const positional = args.filter((arg, index) => !arg.startsWith("--") && !valueFlags.has(args[index - 1] ?? ""));
  const input = positional[0];
  if (!input) {
    console.error(CHECK_HELP);
    process.exitCode = 2;
    return;
  }
  const failOn = (option(args, "--fail-on") ?? "error") as Severity;
  if (!["error", "warning", "info"].includes(failOn)) {
    console.error("--fail-on must be error, warning, or info");
    process.exitCode = 2;
    return;
  }
  const baselineOption = option(args, "--baseline");
  const baselinePath = baselineOption ? path.resolve(baselineOption) : null;
  const writeBaseline = args.includes("--write-baseline");
  const core = option(args, "--core");
  try {
    let baseline: BaselineEntry[] | undefined;
    if (baselinePath && !writeBaseline) baseline = readBaseline(baselinePath);
    if (writeBaseline) baseline = [];
    const report = await checkPackage(input, { ...(baseline ? { baseline } : {}), ...(core ? { coreVersion: core } : {}) });
    if (writeBaseline) {
      const target = baselinePath ?? path.join(path.resolve(input), BASELINE_FILE);
      fs.writeFileSync(target, `${JSON.stringify(baselineFor(report.findings), null, 2)}\n`);
      console.log(`Wrote ${report.findings.length} finding(s) to ${target}`);
      return;
    }
    console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : formatText(report));
    process.exitCode = exitCode(report, failOn);
  } catch (error) {
    console.error(`justflows check: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
