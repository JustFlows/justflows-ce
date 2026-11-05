// SPDX-License-Identifier: MIT

import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "../../../src/lib/database/db.js";
import {
  MIGRATION_ORDER,
  runAllMigrations,
  type DbDriver,
} from "../../../src/lib/database/run-migrations.js";

/**
 * Run only against a disposable database created for the security matrix:
 *   SECURITY_TEST_DATABASE=1 DB_NAME=security_test DB_DRIVER=postgres|mysql \
 *   pnpm vitest run tests/integration/database/security-migrations-db.integration.test.ts
 */
const enabled =
  process.env.SECURITY_TEST_DATABASE === "1" && process.env.DB_NAME === "security_test";

describe.skipIf(!enabled)("fresh and upgraded security schema on a real database", () => {
  const driver = process.env.DB_DRIVER as DbDriver;

  afterAll(async () => {
    await (await getDb()).close();
  });

  it("installs the prior schema, upgrades to the current revision, and is idempotent", async () => {
    const db = await getDb();
    const previous = MIGRATION_ORDER.slice(0, -1);
    const latest = MIGRATION_ORDER.at(-1)!;

    const fresh = await runAllMigrations(db, driver, previous);
    expect(fresh.applied).toEqual(previous);

    const upgraded = await runAllMigrations(db, driver);
    expect(upgraded.applied).toEqual([latest]);
    expect(upgraded.skipped).toEqual(previous);

    const repeated = await runAllMigrations(db, driver);
    expect(repeated.applied).toEqual([]);
    expect(repeated.skipped).toEqual(MIGRATION_ORDER);

    const required = await Promise.all([
      db.query("SELECT site_id FROM storage_quota_locks WHERE 1 = 0"),
      db.query("SELECT id, locked_by, locked_until FROM job_queue WHERE 1 = 0"),
      db.query("SELECT site_id, frequency, scope FROM backup_schedules WHERE 1 = 0"),
    ]);
    expect(required).toEqual([[], [], []]);
  });
});
