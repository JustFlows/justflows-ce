---
name: justflows-data
description: Change Justflows database schemas, queries, adapters, migrations, and persistence-backed behavior across PostgreSQL, MySQL, and MariaDB. Use whenever stored data or migration compatibility is affected.
---

# Justflows Data

Read `packages/database/src`, the latest files in `migrations/`, and the calling domain service before editing. Treat all three supported databases as one product contract.

- Never rewrite a shipped migration. Add the next numeric migration in `.sql`, `.mysql.sql`, and `.mariadb.sql` forms.
- Keep logical schemas equivalent while using dialect-correct types, defaults, indexes, quoting, and DDL.
- Prefer additive, restart-safe transitions. Account for existing rows before required columns or constraints.
- Define recovery expectations for destructive or long-running transformations; never silently discard data.
- Keep runtime schema/types and migration SQL synchronized.
- Use parameterized queries and existing adapters.
- Make ownership, locale behavior, timestamps, pagination, ordering, and transaction boundaries explicit.

Add tests for constraints and edge cases, then run `pnpm --filter @justflows/database typecheck`, its tests, and checks for affected consumers.
