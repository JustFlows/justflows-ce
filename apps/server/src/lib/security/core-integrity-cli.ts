// SPDX-License-Identifier: MIT

import path from "node:path";
import { pathToFileURL } from "node:url";
import { verifyCoreIntegrity, writeCoreManifest } from "./core-integrity.js";

/**
 * Check or write the core file manifest.
 *
 *   node apps/server/dist/lib/security/core-integrity-cli.js
 *   node apps/server/dist/lib/security/core-integrity-cli.js write-local
 *   node apps/server/dist/lib/security/core-integrity-cli.js write-official
 *
 * write-official reads the private key from JUSTFLOWS_CORE_RELEASE_KEY.
 * A missing manifest is unverified and exits 0. A mismatch exits 1.
 */

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (invokedDirectly) {
  await runCli();
}

async function runCli(): Promise<void> {
  const command = process.argv[2] ?? "verify";
  if (command === "write-local") {
    const written = await writeCoreManifest({ kind: "local" });
    console.log(`wrote ${written.count} files`);
    return;
  }
  if (command === "write-official") {
    const privateKeyPem = process.env.JUSTFLOWS_CORE_RELEASE_KEY;
    if (!privateKeyPem) {
      console.error("core-integrity: set JUSTFLOWS_CORE_RELEASE_KEY");
      process.exit(1);
    }
    const written = await writeCoreManifest({ kind: "official", privateKeyPem });
    console.log(`wrote ${written.count} files`);
    return;
  }
  if (command === "verify") {
    const report = await verifyCoreIntegrity();
    console.log(JSON.stringify(report));
    if (report.status === "failed") process.exit(1);
    return;
  }
  console.error("core-integrity: verify | write-local | write-official");
  process.exit(1);
}
