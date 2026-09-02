---
name: justflows-deployment
description: Change or verify Justflows Docker, shared-hosting, startup, build, packaging, updater, environment, and release workflows. Use for distribution and production-operability work.
---

# Justflows Deployment

Read affected paths in `docker/`, `scripts/`, `server.js`, `.env.production.example`, `packages/updater`, and installation logic. Preserve Docker, shared hosting/cPanel, and source development paths.

- Production artifacts must contain compiled server/admin output, views, catalogs, migrations, themes, and runtime dependencies without source-only assumptions.
- Keep PostgreSQL, MySQL, and MariaDB Compose variants aligned.
- Never bake secrets into images or archives. Document variables in example env files.
- Startup and setup must be restart-safe, actionable on failure, and non-destructive for installed sites.
- Exclude Git metadata, real env files, caches, uploads, logs, and unnecessary developer artifacts from packages.
- Updaters need integrity validation, staging, backup/rollback, and traversal/partial-replacement protection.
- Preserve graceful shutdown, health behavior, writable paths, proxy headers, and non-root permissions.

Verify the relevant artifact or container path when possible, not only compilation. Report production paths that could not be exercised.

- Every GitHub release body must copy the complete matching version section from `CHANGELOG.md`, verbatim through the next version heading. Preserve all headings and entries (`Added`, `Changed`, `Fixed`, `Removed`, and any other category present). Do not use generated GitHub notes as a substitute. After publishing, read the release body back and verify every changelog heading is present.
- When a public version is cut on `justflows-ce`, close each [Public Roadmap](https://github.com/orgs/JustFlows/projects/35) issue linked from that version's `CHANGELOG.md` section (see `.agents/skills/justflows-changelog/SKILL.md`).
- When syncing private → public, keep `.github/workflows/ci.yml` free of `actions/dependency-review-action`. That action requires GitHub Dependency graph, which `justflows-ce` does not have, and has failed public PRs more than once. Leave advisory gating on `pnpm audit --audit-level high`.
