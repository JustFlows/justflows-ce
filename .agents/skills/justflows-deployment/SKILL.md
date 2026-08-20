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
