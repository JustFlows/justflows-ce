# Naming and structure conventions

This document is the canonical reference for how files, folders, and packages
are named across Justflows CE. Most of the repository already follows these
rules by convention; this page makes the rules explicit so new packages,
plugins, and PRs stay consistent. If you add a folder or naming pattern this
document doesn't cover, extend it in the same PR.

## Top-level layout

| Path                     | Contents                                       | Naming                                                                                   |
| ------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `apps/server`            | Express app, EJS views, and the Vite SSR admin | see below                                                                                |
| `packages/<name>`        | Framework-neutral domain packages              | lower-kebab package name, scoped `@justflows/<name>`                                     |
| `plugins/<name>`         | Example and developer plugin workspaces        | lower-kebab, matches the plugin id's last segment                                        |
| `themes/<name>`          | Presentation themes                            | lower-kebab                                                                              |
| `css-providers/<name>`   | CSS framework integrations                     | lower-kebab, one word where possible (`open-props` is the accepted multi-word exception) |
| `docs/*.md`              | Author/extension guides                        | `UPPERCASE.md`, except `README.md`                                                       |
| `licenses/*.md`          | Licensing policy documents                     | `NN-slug.md`, zero-padded two-digit prefix in reading order                              |
| `migrations/*.sql`       | Database migrations                            | `NNNN_description[.dialect].sql`, see [Migrations](#migrations)                          |
| `docker`, `scripts`      | Distribution and release tooling               | lower-kebab                                                                              |
| `.agents/skills/<skill>` | Agent skill guides                             | `justflows-<area>`, one `SKILL.md` per folder, plus `agents/{claude,cursor,openai}.yaml` |

`apps/` is plural because it is the workspace category for deployable
applications, not a count; it currently holds one app (`apps/server`) and may
hold more later (e.g. a future worker or CLI app). Don't rename it to
singular when there's only one entry.

## Packages (`packages/*`)

- Package directory name and npm name are the same slug: `packages/plugin-api` ⇒ `@justflows/plugin-api`.
- Every package has a single barrel at `src/index.ts`. Consumers import the
  package by its public export, not by deep path, unless the package
  explicitly documents subpath exports (e.g. `packages/database/src/schema/*`).
- Source files are `kebab-case.ts` throughout `packages/*/src`. No camelCase
  or PascalCase filenames — this holds with zero exceptions today; keep it
  that way.
- Prefer a flat `src/` over a directory-per-file. Wrap a concern in its own
  subdirectory only when it holds more than one file (multiple modules,
  or an implementation plus its types). A folder containing a single
  `hash.ts` or a single `types.ts` should usually just be a top-level file
  (`hash.ts`, `types.ts`) instead.
- Tests live outside `src` in the owning package's `tests/unit/` or
  `tests/integration/` tree. Mirror source subfolders when useful; keep the
  `<name>.test.ts` suffix. See [Tests](#tests).

## `apps/server/src` (Express app)

- `routes/<domain>/<resource>.ts`: one file per resource, named for the resource the
  routes serve. Use the plural form for collection-style resources
  (`blocks.ts`, `menus.ts`, `themes.ts`, `users.ts`) and the singular/mass
  form for singleton or whole-site concerns (`content.ts`, `install.ts`,
  `security.ts`, `settings.ts`, `site.ts`). When in doubt, match the plural
  default.
- `middleware/<concern>.ts`: kebab-case, named for what the middleware
  enforces or attaches, not for where it's used.
- `lib/<domain>/<concern>.ts`: kebab-case. Files that read/write a specific table or
  domain use the `<concern>-db.ts` suffix (`themes-db.ts`, `menus-db.ts`,
  `plugins-db.ts`, `css-providers-db.ts`); keep using that suffix for new
  DB-access modules so it stays a reliable signal.
- `views/*.ejs`: flat, kebab-case for multi-word views
  (`under-construction.ejs`). Nest only for genuinely reusable fragments,
  as `views/partials/` already does.
- `views/static/*.html`: plain (non-EJS) HTML consumed by a dependency-free
  renderer that cannot assume the EJS engine or database is reachable
  (`error-fallback.html`, loaded via simple `{{TOKEN}}` string substitution
  by `lib/rendering/static-error-page.ts`). Reserve this folder for that case, not as
  a general alternative to `.ejs`.
- Group `lib` by responsibility: authentication in `auth/`, database connection
  and migrations in `database/`, mail in `email/`, content in `content/`,
  extension runtime in `plugins/`, and rendering in `rendering/`. Existing
  `i18n/` and `static-export/` remain self-contained. Keep framework-neutral
  behavior in its existing `packages/*` owner; folders do not create new APIs.
- Group HTTP routes by domain (`auth/`, `content/`, `design/`, `settings/`,
  `system/`, etc.). Keep `manage-api/` as the versioned management API boundary.
  Route registration order remains explicit in `register-routes.ts`.
- Server tests live in `apps/server/tests/`, not in `src`.
- A package (`packages/x`) and its host-side wiring in `apps/server/src/lib`
  may legitimately share a base filename when one wraps the other (for
  example `packages/cache/src/jf-cache.ts` and
  `apps/server/src/lib/cache/jf-cache.ts`, or `site-widgets.ts` in both
  `packages/blocks/src/core` and `apps/server/src/lib/rendering`). This is intentional,
  not a collision — the package file is framework-neutral logic and the
  `apps/server` file is the Express-side singleton/wiring around it.

## `apps/server/public-scripts/src` (compiled `public/js/*.js`)

- One `.ts` file per script, flat, kebab-case, matching the served filename
  (`site-nav.ts` → `/js/site-nav.js`). Each file is fully independent — no
  imports between them — since each ships as its own standalone IIFE.
- `apps/server/public-scripts/build.mjs` compiles them with esbuild into
  `public/js/*.js` (repo root) at the same stable, non-content-hashed
  filenames the served URLs have always used; `public-scripts/tsconfig.json`
  exists only for `tsc --noEmit` type-checking (esbuild does not type-check).
  Both run as part of `pnpm --filter @justflows/server build`/`typecheck`.
- `public/js/*.js` is generated and gitignored (see `.gitignore`) — same
  convention as `apps/server/admin-ui/dist`. Edit the `.ts` source, not the
  compiled file; run `pnpm --filter @justflows/server dev:public-scripts` for
  a watch build while iterating.
- A file needing a custom `Window`/global augmentation (`declare global`)
  needs at least one top-level `import`/`export` for TypeScript to treat it
  as a module; these files add a trailing `export {};`, which esbuild strips
  from the IIFE output entirely.
- Never emit these as inline `<script>` blocks server-side — the default
  public-site CSP is `script-src 'self'` with no `'unsafe-inline'`, which
  silently drops inline scripts. Pass server-rendered config via `data-*`
  attributes on the `<script src="...">` tag (read via
  `document.currentScript.dataset`), not an inline config block — see
  `pwa-install.ts` and `pwa-public.ts`.

## `apps/server/admin-ui/src` (SSR admin application)

- `entry-server.tsx` is the Node render entry; `entry-client.tsx` is the browser
  hydration entry. Shared components must render without browser globals.
- `ssr-data.ts` is the typed boundary for request-scoped initial data. Never put
  secrets or data outside the current session's capabilities in this payload.
- Import `Link`, `NavLink`, `Navigate`, and `useNavigate` from `admin-router`
  so rendered links and navigation use the configured admin base path. For
  native anchors or browser navigation, resolve admin URLs with `publicAdminPath`
  from `admin-path`; keep API and public-site URLs unchanged.
- Vite writes browser assets to `dist/client` and the Node renderer to
  `dist/server`; distribution paths must include both.

- `pages/<Name>Page.tsx`: one top-level React page per admin screen, PascalCase,
  suffixed `Page`. Group route-scoped page families in a subfolder named for
  the group (`pages/admin/security/`).
- `components/<Name>.tsx`: PascalCase, one component per file. Group a
  cohesive feature's components in a lower-kebab subfolder
  (`components/builder/`), not by file type.
- Non-component logic inside a feature folder (state helpers, tree/DOM
  utilities, types) is `kebab-case.ts` (`components/builder/block-tree.ts`,
  `dnd.ts`, `grid.ts`), matching the package convention above.
- Hooks are `camelCase.ts` starting with `use`
  (`components/builder/useBuilderHistory.ts`), matching standard React
  convention — this is the one deliberate exception to kebab-case for
  non-component files.
- `lib/`, `config/`, `i18n/`: kebab-case utility modules.
- Group admin pages under `pages/admin/<domain>/` (for example `content/`,
  `design/`, `extensions/`, `settings/`, and `security/`). Feature-specific
  panels belong with their pages; shared components remain in `components/`.
- Tests live in `apps/server/admin-ui/tests/`, mirroring `pages/`,
  `components/`, `lib/`, and `config/`. Shared setup and accessibility helpers
  live in `tests/helpers/`. The browser suite has its own jsdom Vitest project.

## Tests

Every app, package, and example plugin owns its tests. Do not create a shared
monorepo test dumping ground or put new test files inside production `src`.

```text
apps/server/
  src/lib/<domain>/
  src/routes/<domain>/
  tests/unit/<domain>/
  tests/integration/routes/<domain>/
  tests/integration/middleware/
  tests/integration/database/
  admin-ui/src/pages/admin/<domain>/
  admin-ui/tests/pages/admin/<domain>/
packages/<name>/
  src/
  tests/unit/
  tests/integration/          # when needed
```

- Unit suites test an isolated behavior. HTTP suites exercising Express routes
  belong under `tests/integration/routes/`, including suites using mocked DBs.
  HTTP middleware suites belong under `tests/integration/middleware/`.
  Real database suites belong under `tests/integration/database/`; preserve
  their disposable-database opt-in guards. Public script unit tests live in
  `apps/server/tests/unit/public-scripts/` and use jsdom.
- Put shared fixtures and helpers under the owning `tests/` tree when needed;
  do not add empty placeholder directories. Keep `.integration.test.ts` on
  opt-in database suites so their execution requirements remain visible.
- Each owner's `vitest.config.ts` discovers `tests/**/*.test.ts(x)` only.
  Root `vitest.config.mts` lists the server, browser, package, and example-plugin
  projects. `pnpm test` runs declared workspace test scripts through Turbo.
  Packages without tests do not declare a test script; add one with the first
  real suite rather than using `--passWithNoTests`.
- Production TypeScript configs exclude tests. Server, package, and example
  plugin `tsconfig.tests.json` files typecheck tests without emitting them, and
  their normal `typecheck` scripts run that check too. Use
  `pnpm typecheck:tests` to run these checks directly. Browser tests run
  in the admin Vitest suite; Vite builds the admin client and SSR bundles.
- A move must update static imports, dynamic imports, mocks, fixtures,
  module-relative assets, compiled worker paths, and documented commands.
  Validate a clean build so stale output cannot conceal broken paths.
- Internal `file:` dependencies are retained for distribution. Turbo build
  tasks explicitly list these dependencies because its workspace graph does
  not infer them here. Keep those edges in `turbo.json` in sync when adding
  a dependency; tests and typechecks depend on their own package build.

## Plugins (`plugins/*`)

- Directory name matches the plugin id's final segment
  (`justflows.hello-world` ⇒ `plugins/hello-world`).
- Minimum layout: `justflows.json`, `package.json`, `src/index.ts`. See
  [PLUGINS.md](PLUGINS.md) and [MANIFEST.md](MANIFEST.md).
- Copy `plugins/hello-world` to start a new plugin; don't hand-build the
  layout from scratch.

## Themes (`themes/*`)

- `justflows-theme.json` (or `justflows.json`) marks a directory as a theme.
- Theme metadata declares `engines.justflows`; a packaged theme repeats the
  same range in its archive-root `justflows.json` install manifest.
- `styles/`, `patterns/`, `demo/` are the recognized subfolders; see
  [THEMES.md](THEMES.md) for exactly what the host reads from each.

## `docs/` and `licenses/`

- `docs/*.md` guides are named `UPPERCASE.md` for the topic they cover
  (`PLUGINS.md`, `THEMES.md`, `MANIFEST.md`). `README.md` is the index and is
  the only mixed-case file in the folder. New author-facing guides follow
  this pattern and get a row in `docs/README.md`'s table.
- `licenses/*.md` are named `NN-slug.md`, numbered in the order
  `LICENSING.md` presents them. The number is load-bearing — it's
  cross-referenced by `CONTRIBUTING.md` and `LICENSING.md` — so don't
  renumber an existing file; append the next number for a new policy
  document.

## Migrations

- `NNNN_description.sql` for Postgres (the default dialect, no suffix) and
  `NNNN_description.mysql.sql` for MySQL. MariaDB reuses the MySQL file: the
  runner tries `.mariadb.sql`, then `.mysql.sql`, then the bare `.sql`
  (`migrationFileCandidates` in `run-migrations.ts`). Only add a separate
  `NNNN_description.mariadb.sql` when the DDL must actually differ between the
  two — it has not so far, and `0013`–`0016` no longer carry one. Only the
  consolidated `0012_baseline` still ships all three files.
- Zero-pad the number to four digits. Use `snake_case` for the description.
- `0012_baseline` contains the ordered schema history from `0001` through
  `0012`. It is used for both fresh installations and upgrades from older
  releases, then recorded once in the existing `_migrations` table.
- Never edit the shipped `0012_baseline` or a later applied migration (see
  `AGENTS.md`). Add the next number, even if only one dialect's schema
  actually changes. Find the highest number in `migrations/` and use the next number;
  `0033_spam_term_source` is currently the latest.
- Add each new migration name to `MIGRATION_ORDER` in
  `apps/server/src/lib/database/run-migrations.ts`. The runner skips names already
  recorded in `_migrations`.

## Scripts (`scripts/*`)

- Prefer `.js` for Node scripts at the repo root's CommonJS default. Reach
  for `.cjs` only when a script must force CommonJS despite `"type": "module"`
  being set somewhere in its resolution path — not as a stylistic choice.
  (`scripts/bootstrap-gate.cjs` and `scripts/install-token.cjs` predate this
  rule and don't need the distinction; new scripts should default to `.js`.)

For copyable workspace, focused-suite, and database commands, see
[local testing](TESTING-EXTENSIONS.md#workspace-verification).

## Resolved gaps

These were flagged in the initial structure audit and have since been fixed
to match the rules above:

- Public scripts live in `apps/server/public-scripts/src/`. Their compiled
  `public/js/*.js` output is generated and gitignored.
- `apps/server/src/lib/i18n/admin-catalogs/` and
  `apps/server/src/lib/i18n/site-catalogs/` hold different catalogs (the
  admin application's nested translation bundle vs. the public site's flat one), and
  the parallel `-catalogs` suffix makes that distinction explicit instead of
  one directory looking like the unqualified default.
- `packages/auth/src` no longer wraps single-file concerns in their own
  subdirectories: `password/hash.ts` → `password.ts`,
  `capabilities/index.ts` → `capabilities.ts`, `session/types.ts` →
  `session.ts`, matching the flat style of `sdk`, `updater`, and `jobs`.
