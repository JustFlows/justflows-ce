# Themes

Themes are **not** EJS template trees. Public pages use the core layout plus
rendered blocks. A theme supplies CSS, block patterns, and an optional demo
home.

## Resolution order

`resolveThemeDir` in `apps/server/src/lib/theme-files.ts`:

1. The theme's stored `installedPath` (uploaded `.jfpkg`)
2. `packages-installed/themes/<id>/` (latest version folder)
3. Bundled `themes/<slug>/` (id `justflows.default` → `themes/default`)

A directory is a theme if it contains `justflows-theme.json` or
`justflows.json`.

## Files the host reads

| Path | Used for |
| --- | --- |
| `styles/global.css` | Concatenated into `/theme.css` |
| `styles/components.css` | Same |
| `styles/blocks.css` | Same |
| `patterns/*.json` | Page-builder patterns |
| `demo/home.json` | Default home blocks when no page exists |

Presentation defaults (site title, tagline, colors) live in Customizer mods.
Behavior belongs in plugins via hooks.
