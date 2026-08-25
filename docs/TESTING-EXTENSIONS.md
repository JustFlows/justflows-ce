# Testing extensions against Community Edition

## Unit tests

`plugins/hello-world` uses Vitest with a mocked context. Copy that pattern for
hook registration and `activate` / `deactivate`.

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
