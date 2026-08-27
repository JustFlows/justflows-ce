// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  MIGRATION_ORDER,
  isIgnorableMigrationError,
  runMigrationStatements,
} from "../run-migrations.js";

describe("MIGRATION_ORDER", () => {
  it("includes persisted content types", () => {
    expect(MIGRATION_ORDER).toContain("0005_content_types");
  });

  it("repairs audit tables created by the initial schema", () => {
    expect(MIGRATION_ORDER).toContain("0009_audit_log_compat");
  });

  it("includes working content revisions", () => {
    expect(MIGRATION_ORDER.at(-1)).toBe("0010_content_revisions");
  });
});

describe("isIgnorableMigrationError", () => {
  it("ignores MySQL/MariaDB DROP INDEX when the key is already gone", () => {
    const err = Object.assign(new Error("Can't DROP INDEX `uq_content_slug`; check that it exists"), {
      code: "ER_CANT_DROP_FIELD_OR_KEY",
      errno: 1091,
    });
    expect(isIgnorableMigrationError(err)).toBe(true);
  });

  it("does not ignore missing-table errors", () => {
    expect(isIgnorableMigrationError(new Error("Table 'justflows.content_types' doesn't exist"))).toBe(false);
  });
});

describe("runMigrationStatements", () => {
  it("continues past a missing unique index on MySQL re-runs", async () => {
    const ran: string[] = [];
    await runMigrationStatements(
      {
        async run(sql) {
          ran.push(sql);
          if (sql.includes("DROP INDEX")) {
            throw Object.assign(new Error("Can't DROP INDEX `uq_content_slug`; check that it exists"), {
              code: "ER_CANT_DROP_FIELD_OR_KEY",
            });
          }
        },
      },
      "ALTER TABLE content DROP INDEX uq_content_slug;\nALTER TABLE content ADD UNIQUE KEY uq_content_slug_locale (site_id, type, slug(200), locale);",
      "mariadb",
    );
    expect(ran).toHaveLength(2);
  });

  it("retries DROP INDEX without IF EXISTS on MySQL 8", async () => {
    const ran: string[] = [];
    await runMigrationStatements(
      {
        async run(sql) {
          ran.push(sql);
          if (/\bIF EXISTS\b/i.test(sql)) {
            throw new Error("You have an error in your SQL syntax near 'IF EXISTS'");
          }
        },
      },
      "ALTER TABLE content DROP INDEX IF EXISTS uq_content_slug;",
      "mysql",
    );
    expect(ran).toEqual([
      "ALTER TABLE content DROP INDEX IF EXISTS uq_content_slug",
      "ALTER TABLE content DROP INDEX uq_content_slug",
    ]);
  });
});
