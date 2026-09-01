// SPDX-License-Identifier: MIT

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const entry = path.join(root, "packages/sdk/src/index.ts");
const snapshotPath = path.join(root, "packages/sdk/api-surface.json");
const sdkPackagePath = path.join(root, "packages/sdk/package.json");
const sdkVersionPath = path.join(root, "packages/sdk/src/version.ts");
const configPath = path.join(root, "packages/sdk/tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
const program = ts.createProgram(parsed.fileNames, parsed.options);
const source = program.getSourceFile(entry);
if (!source) throw new Error(`SDK entrypoint not found: ${entry}`);
const symbol = program.getTypeChecker().getSymbolAtLocation(source);
if (!symbol) throw new Error("Could not inspect the @justflows/sdk module");

const current = program
  .getTypeChecker()
  .getExportsOfModule(symbol)
  .map((item) => item.getName())
  .filter((name) => name !== "default")
  .sort();

const sdkPackage = JSON.parse(fs.readFileSync(sdkPackagePath, "utf8"));
const versionSource = fs.readFileSync(sdkVersionPath, "utf8");
const declaredSdkVersion = versionSource.match(/SDK_VERSION\s*=\s*"([^"]+)"/)?.[1];
if (declaredSdkVersion !== sdkPackage.version) {
  console.error(
    `SDK_VERSION (${declaredSdkVersion ?? "missing"}) does not match packages/sdk/package.json (${sdkPackage.version}).`,
  );
  process.exit(1);
}

if (process.argv.includes("--update")) {
  fs.writeFileSync(snapshotPath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Updated SDK API snapshot (${current.length} exports).`);
  process.exit(0);
}

const expected = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const removed = expected.filter((name) => !current.includes(name));
const added = current.filter((name) => !expected.includes(name));
if (removed.length || added.length) {
  if (removed.length) console.error(`Removed public SDK exports: ${removed.join(", ")}`);
  if (added.length) console.error(`New public SDK exports not snapshotted: ${added.join(", ")}`);
  console.error(
    "Restore/deprecate removals, or run `pnpm sdk:api:update` for an intentional additive change.",
  );
  process.exit(1);
}
console.log(`SDK API snapshot matches (${current.length} exports).`);
