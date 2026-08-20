# Justflows agent guide

## Scope

These instructions apply to the entire repository. Load the focused skill in `.agents/skills/` that matches the work before making changes. Use `justflows-platform` first for cross-cutting or architectural work.

## Repository invariants

- This is a pnpm/Turborepo TypeScript monorepo. Use pnpm and workspace filters; do not introduce a second package-management path.
- Keep `packages/core` independent of Express, React, and EJS. Framework integration belongs in `apps/server`.
- Treat `packages/sdk` as a stable public contract. Coordinate compatible changes through the SDK, plugin runtime, example extension, and tests.
- Support PostgreSQL, MySQL, and MariaDB wherever persistence changes. Never edit an applied migration; add the next numbered migration for every dialect.
- Preserve browser-first installation and administration. Production users must not need a source checkout or build toolchain.
- Never weaken authentication, capability checks, path validation, archive validation, HTML sanitization, upload limits, or secret handling.
- New core source files start with `// SPDX-License-Identifier: MIT`. Extension manifests declare their own license; Marketplace listings use a GPL-compatible license.
- Do not commit credentials, real `.env` files, generated builds, uploads, caches, or dependency directories.
- Preserve unrelated working-tree changes. Make the smallest coherent change and verify it at the narrowest useful scope.

## Working map

- `apps/server/src`: Express app, routes, middleware, services, EJS, installation, and runtime integration.
- `apps/server/admin-ui`: React/Vite administration SPA.
- `packages/core`: lifecycle, hooks, configuration, logging, and health.
- `packages/database`: adapters, schema, migration tooling, and queries.
- `packages/sdk`: public plugin/theme types and APIs.
- `packages/plugin-api`: extension loading, manifests, activation, and runtime boundaries.
- `packages/{auth,content,blocks,media,installer,updater,cache,jobs}`: domain packages.
- `plugins/`: developer workspace for plugins. Create `plugins/<name>/` and start there. `plugins/hello-world` is the example to copy.
- `themes/default` and `css-providers`: presentation integrations.
- `migrations`: shipped SQL migrations for all database dialects.
- `docker`, `scripts`, and `server.js`: distribution, hosting, startup, and releases.

## Verification

Use package-level checks while iterating, then relevant root checks when practical. Typical commands are `pnpm --filter <package> typecheck`, `pnpm --filter <package> test`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Report checks not run and why.

