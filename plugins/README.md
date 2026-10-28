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
├── helpdesk/        First-party Helpdesk (tickets, portal, handover)
├── demo/            Demo sign-in and scheduled plugin reset
├── consent/         First-party Cookie Consent (banner, consent API, script/embed gating)
├── quotes/          Shop quotes: a quote for this site's shop, which can become an order
├── shared-files/    Private folders and upload requests for one user on this site
└── acme-seo/        Your plugin (folder name is yours)
```

`quotes/` is a Shop plugin. It cannot be installed until Shop is installed on this site. It is listed with the shop, adds a Shop quotes section to the core `/account` page, and asks Shop to open the order when a customer accepts. `shared-files/` is separate. Each one owns only its own rows and allows multisite. Payment links live in Shop, next to the payment gateway. See each plugin's README.

`helpdesk/` is the first-party support desk ([#184](https://github.com/JustFlows/justflows-ce/issues/184)).
It uses only `@justflows/sdk` and ships its own admin app. See [plugins/helpdesk/README.md](helpdesk/README.md).

`demo/` is a standalone sandbox: a Demo role and demo user, an administrator
who is never edited, and a scheduled reset of whatever installed plugins
declare through `justflows.demo.targets`, `justflows.demo.snapshot`, and
`justflows.demo.restore`. See [plugins/demo/README.md](demo/README.md).

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
      "id": "reports",
      "label": "Reports",
      "path": "/admin/reports",
      "icon": "📊",
      "domain": "extensions"
    }
  ]
}
```

| Field      | Notes                                                                    |
| ---------- | ------------------------------------------------------------------------ |
| `id`       | Lowercase kebab-case, unique within the plugin                           |
| `label`    | English label, shown when no translation applies                         |
| `labelKey` | Optional i18n key, looked up in the plugin's `adminApp.locales` catalogs, then in core's |
| `labels`   | Optional `{ "<locale>": "<label>" }`; wins over `labelKey` in that locale |
| `path`     | Must be an `/admin/…` route                                              |
| `icon`     | Single emoji; defaults to 🔌                                             |
| `domain`   | `content`, `appearance`, `extensions` (default), `security`, or `system` |
| `roles`    | Optional role ids that may open the page, such as a role the plugin registers; default administrators and editors |

To translate the menu label, either put `labelKey` in your admin app's own
catalogs (`adminApp.locales`, e.g. `"menu.forms": "Formulieren"` in
`locales/nl.json`), or list `labels` per locale in the manifest. The sidebar
uses the label for the admin language (`nl-NL` falls back to `nl`), then
`label`. Core's catalogs hold no plugin labels, so do not rely on a core key.

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
