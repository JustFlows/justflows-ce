// SPDX-License-Identifier: MIT

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { migrationsDir } from "../jf-root.js";
import {
  MIGRATION_ORDER,
  isIgnorableMigrationError,
  runAllMigrations,
  runMigrationStatements,
  splitSqlStatements,
} from "../run-migrations.js";

describe("MIGRATION_ORDER", () => {
  it("uses the consolidated schema through migration 0012, then tracked migrations", () => {
    expect(MIGRATION_ORDER).toEqual(["0012_baseline", "0013_public_comments"]);
  });

  it("ships 0013_public_comments for every database dialect", () => {
    for (const suffix of [".sql", ".mysql.sql", ".mariadb.sql"]) {
      const ddl = fs.readFileSync(
        path.join(migrationsDir(), `0013_public_comments${suffix}`),
        "utf8",
      );
      const statements = splitSqlStatements(ddl, suffix === ".sql" ? "postgres" : "mysql");
      expect(statements.some((s) => /ALTER TABLE comments ADD COLUMN.*notify/i.test(s))).toBe(true);
      expect(statements.some((s) => /CREATE INDEX .*idx_comments_thread/i.test(s))).toBe(true);
    }
  });

  it("does not rebuild MySQL/MariaDB revisions with a new foreign key or generated unique slot", () => {
    for (const dialect of ["mysql", "mariadb"] as const) {
      const ddl = fs.readFileSync(
        path.join(migrationsDir(), `0012_baseline.${dialect}.sql`),
        "utf8",
      );
      const revisionDdl = ddl
        .split("Consolidated migration: 0010_content_revisions")[1]
        ?.split("Consolidated migration: 0011_default_locale_en_us")[0] ?? "";
      const statements = splitSqlStatements(revisionDdl, dialect);
      expect(statements.join("\n")).not.toMatch(/FOREIGN KEY/i);
      expect(statements.join("\n")).not.toMatch(/GENERATED ALWAYS/i);
      expect(statements.join("\n")).not.toMatch(/CREATE UNIQUE INDEX/i);
    }
  });

  it("contains every legacy migration in order for each database dialect", () => {
    const names = [
      "0001_initial",
      "0002_multilingual",
      "0003_css_providers",
      "0004_plugin_data",
      "0005_content_types",
      "0006_session_revocation",
      "0007_totp",
      "0008_audit_log",
      "0009_audit_log_compat",
      "0010_content_revisions",
      "0011_default_locale_en_us",
      "0012_template_parts",
    ];

    for (const suffix of [".sql", ".mysql.sql", ".mariadb.sql"]) {
      const ddl = fs.readFileSync(path.join(migrationsDir(), `0012_baseline${suffix}`), "utf8");
      const positions = names.map((name) => ddl.indexOf(`Consolidated migration: ${name}`));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });
});

describe("runAllMigrations", () => {
  it("records a migration and skips it after it has been applied", async () => {
    const ran: string[] = [];
    const applied = new Set<string>();
    const sql = {
      async run(statement: string, params: (string | number | boolean | null)[] = []) {
        ran.push(statement);
        if (statement.startsWith("INSERT INTO _migrations") && params[0] !== undefined) {
          applied.add(String(params[0]));
        }
      },
      async query<T>() {
        return [...applied].map((name) => ({ name })) as T[];
      },
    };

    await runAllMigrations(sql, "postgres", ["0012_baseline"]);
    const firstRunCount = ran.length;
    await runAllMigrations(sql, "postgres", ["0012_baseline"]);

    expect(applied).toEqual(new Set(["0012_baseline"]));
    expect(ran.slice(firstRunCount)).toEqual([
      expect.stringContaining("CREATE TABLE IF NOT EXISTS _migrations"),
    ]);
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

  it("ignores a PostgreSQL migration name that was already recorded", () => {
    expect(
      isIgnorableMigrationError(
        new Error('duplicate key value violates unique constraint "_migrations_name_key"'),
      ),
    ).toBe(true);
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
