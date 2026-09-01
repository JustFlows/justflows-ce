# Plugins

This is where you write a Justflows plugin.

Create a folder here named after your plugin and start building. The pnpm
workspace includes `plugins/*`, and a source checkout of the server lists
whatever is in this directory.

Author docs: [docs/README.md](../docs/README.md) (hooks, manifest, packaging,
themes, blocks, testing, and SDK compatibility).

```
plugins/
├── hello-world/     Official example — copy this
├── consent/         First-party Cookie Consent (banner, consent API, script/embed gating)
└── acme-seo/        Your plugin (folder name is yours)
```

`consent/` is a fuller worked example: a `theme.css` stylesheet, sync `html.head`
and `analytics.head` filters, an async `content.render` filter, plugin HTTP
routes, a bundled browser runtime, an `adminMenu` page, and `plugin_data`
records with a `deleteData` cleanup.

## Start a plugin

1. Copy `hello-world` to a new folder, for example `plugins/acme-seo`.
2. Set a namespaced id in `justflows.json` and `src/index.ts` (`acme.seo`, not `seo`).
3. Declare a GPL-compatible `license` and an `engines.justflows` range in the manifest.
4. Write code in `src/`. Import types from `@justflows/sdk` only.
5. Build so the runtime can load JavaScript:

```bash
pnpm --filter acme.seo build
```

The loader looks for `dist/index.js` or `index.js`. TypeScript in `src/` is not
loaded at runtime.

Minimum files:

| File             | Purpose                                                 |
| ---------------- | ------------------------------------------------------- |
| `justflows.json` | Manifest (`id`, `version`, `license`, `type: "plugin"`) |
| `package.json`   | Workspace package; depend on `@justflows/sdk`           |
| `src/index.ts`   | `activate` / `deactivate` and the plugin module         |

Do not put your plugin under `packages/`. That tree is platform code.

## Add an admin page

A plugin owns the admin pages it registers. Declare them in `justflows.json`
under `adminMenu` and add the `admin:extend` permission:

```json
{
  "permissions": ["admin:extend"],
  "adminMenu": [
    {
      "id": "analytics",
      "label": "Analytics",
      "labelKey": "nav.analytics",
      "path": "/admin/analytics",
      "icon": "📊",
      "domain": "extensions"
    }
  ]
}
```

| Field      | Notes                                                                    |
| ---------- | ------------------------------------------------------------------------ |
| `id`       | Lowercase kebab-case, unique within the plugin                           |
| `label`    | Shown when `labelKey` has no catalog entry                               |
| `labelKey` | Optional admin i18n key, e.g. `nav.analytics`                            |
| `path`     | Must be an `/admin/…` route                                              |
| `icon`     | Single emoji; defaults to 🔌                                             |
| `domain`   | `content`, `appearance`, `extensions` (default), `security`, or `system` |

The entry appears in the sidebar while the plugin is active and disappears when
it is deactivated or deleted — the admin reads the live list from
`GET /api/plugins/admin-menu`. Merely uploading or installing a plugin does not
activate its menu. Only register a `path` the admin application
actually serves; an unrouted path renders a dead link.

## Install on a site without this checkout

Pack a `.jfpkg` and drop it on Admin → **Plugins**. Site owners never copy
folders into `plugins/`; that path is for developers working in the CE source.
Unsigned packages are refused unless you pin a digest or set
`JUSTFLOWS_ALLOW_UNSIGNED_PACKAGES=1` (see [docs/PACKAGING.md](../docs/PACKAGING.md)).
