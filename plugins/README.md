# Plugins

This is where you write a Justflows plugin.

Create a folder here named after your plugin and start building. The pnpm
workspace includes `plugins/*`, and a source checkout of the server lists
whatever is in this directory.

Author docs: [docs/README.md](../docs/README.md) (hooks, manifest, packaging,
themes, blocks, testing).

```
plugins/
├── hello-world/     Official example — copy this
└── acme-seo/        Your plugin (folder name is yours)
```

## Start a plugin

1. Copy `hello-world` to a new folder, for example `plugins/acme-seo`.
2. Set a namespaced id in `justflows.json` and `src/index.ts` (`acme.seo`, not `seo`).
3. Declare a GPL-compatible `license` in the manifest.
4. Write code in `src/`. Import types from `@justflows/sdk` only.
5. Build so the runtime can load JavaScript:

```bash
pnpm --filter acme.seo build
```

The loader looks for `dist/index.js` or `index.js`. TypeScript in `src/` is not
loaded at runtime.

Minimum files:

| File | Purpose |
| --- | --- |
| `justflows.json` | Manifest (`id`, `version`, `license`, `type: "plugin"`) |
| `package.json` | Workspace package; depend on `@justflows/sdk` |
| `src/index.ts` | `activate` / `deactivate` and the plugin module |

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

| Field | Notes |
| --- | --- |
| `id` | Lowercase kebab-case, unique within the plugin |
| `label` | Shown when `labelKey` has no catalog entry |
| `labelKey` | Optional admin i18n key, e.g. `nav.analytics` |
| `path` | Must be an `/admin/…` route |
| `icon` | Single emoji; defaults to 🔌 |
| `domain` | `content`, `appearance`, `extensions` (default), `security`, or `system` |

The entry appears in the sidebar as soon as the plugin is installed and
disappears when it is deactivated or deleted — the admin reads the live list
from `GET /api/plugins/admin-menu`. Only register a `path` the admin SPA
actually serves; an unrouted path renders a dead link.

## Install on a site without this checkout

Pack a `.jfpkg` and drop it on Admin → **Plugins**. Site owners never copy
folders into `plugins/`; that path is for developers working in the CE source.
