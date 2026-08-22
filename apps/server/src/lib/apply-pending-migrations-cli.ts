// SPDX-License-Identifier: MIT
/**
 * Load this file from disk after a core zip copy so migrations use the
 * newly written dist, not the still-running server bundle.
 */
import { applyPendingMigrations } from "./run-migrations.js";

applyPendingMigrations()
  .then(() => {
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
