# Testing Community Edition and extensions

## Workspace verification

Run these commands from the `justflows-ce-development` repository root:

```bash
pnpm install --frozen-lockfile
pnpm test --force
pnpm typecheck
```

`pnpm test --force` runs all declared workspace test scripts and bypasses Turbo's
cached results. It includes server, admin UI, domain packages, and the example
plugin, with required builds ordered first. `pnpm test` allows cache reuse.
For a clean production build, run `pnpm clean` followed by `pnpm build`.

The database integration suites are opt-in and require separate fresh,
disposable databases. They remain skipped during a normal run. Follow the
[scheduling commands](SCHEDULING.md#developer-verification) for `schedule_test`
and [search commands](SEARCH.md#local-verification) for `search_test`. Run them
separately with the corresponding environment variables and connection details.

Tests live in each app/package/plugin's `tests/` folder; see the
[test placement conventions](CONVENTIONS.md#tests). The root `vitest.config.mts`
lists the individual projects, including the separate admin browser project.
Production source configs exclude tests. Server, package, and example-plugin
`typecheck` commands also run their `tsconfig.tests.json` checks; use
`pnpm typecheck:tests` to run just those checks after building dependencies.

For focused runs after a workspace build:

```bash
# Server and admin UI suites
pnpm --filter @justflows/server test

# One server suite
pnpm --filter @justflows/server exec vitest run tests/unit/auth/password.test.ts

# Admin browser suite only
pnpm --filter @justflows/server exec vitest run --config admin-ui/vitest.config.ts
```

## Unit tests

`plugins/hello-world/tests/unit/index.test.ts` uses Vitest with a mocked context.
Copy that pattern for hook registration and `activate` / `deactivate`. Keep new
plugin tests in `plugins/<name>/tests/unit/` and configure the plugin's Vitest
project to discover `tests/**/*.test.ts`; implementation belongs in `src/`.

```bash
pnpm --filter justflows.hello-world test
```

## Against a running CE

1. Create `plugins/<name>/` (see [PLUGINS.md](PLUGINS.md)).
2. `pnpm --filter <package-name> build` so `dist/index.js` exists.
3. Start the server (`pnpm --filter @justflows/server dev`).
4. In Admin → Plugins, activate the plugin. Source checkouts pick up folders
   under `plugins/` without a `.jfpkg`.
5. Exercise the public site and admin flows the plugin claims to change.

To test the same package as a site owner would:

1. Pack a `.jfpkg` ([PACKAGING.md](PACKAGING.md)).
2. Upload it on Admin → Plugins.
3. Activate, exercise the plugin's public and admin behavior, then Deactivate
   and reload both — nothing the plugin adds (admin menu entries, blocks in
   the page builder's catalog, public rendering) should still be there. A
   cached public page should reflect the change too, not just a fresh one.
4. Delete the plugin and repeat the same check — deletion must leave the site
   in the same state deactivation does, not a weaker one.

The host never compiles TypeScript from an uploaded archive. If it works as a
folder in this checkout but fails as a `.jfpkg`, the `dist/` entrypoint is
usually missing from the tarball.
