# Plugin author guide

Start from [`plugins/hello-world`](../plugins/hello-world). That folder is the
supported example: copy it, change the id, and build.

```bash
cp -R plugins/hello-world plugins/acme-seo
# edit plugins/acme-seo/package.json, justflows.json, and src/index.ts
pnpm --filter acme.seo build
```

The loader looks for `dist/index.js` or `index.js`. TypeScript in `src/` is not
loaded at runtime.

Do not put plugins under `packages/` — that tree is platform code.

## Lifecycle

A plugin module exports a default `PluginModule`:

```ts
import type { PluginModule } from "@justflows/sdk";

const plugin: PluginModule = {
  manifest: {
    id: "acme.seo",
    name: "Acme SEO",
    version: "1.0.0",
    license: "GPL-2.0-or-later",
    permissions: [],
    main: "index.js",
  },
  activate(ctx) {
    ctx.hooks.action("content.published", (event) => {
      ctx.logger.info("published", { contentId: event.contentId });
    });
  },
  deactivate() {
    // optional — registered hooks are cleaned up for you
  },
};

export default plugin;
```

`activate` receives `PluginContext`: hooks, settings, logger, cache, HTTP routes,
plugin-scoped data, and `blocks.register`. See [HOOKS.md](HOOKS.md) and
[PERMISSIONS.md](PERMISSIONS.md).

## Admin pages

Declare `adminMenu` and request `admin:extend`. The sidebar reads
`GET /api/plugins/admin-menu` while the plugin is active — an installed-but-not-
yet-activated plugin (or a deactivated one) contributes nothing to the menu.

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

Only register a path the admin SPA actually serves. Unrouted paths become dead
links.

## Two install paths

| Audience | How |
| --- | --- |
| You, in this checkout | Folder under `plugins/`, build `dist/`, activate in Admin |
| Site owners | A `.jfpkg` dropped on Admin → Plugins — see [PACKAGING.md](PACKAGING.md) |

Marketplace listings must use a GPL-compatible license. See `LICENSING.md`.
