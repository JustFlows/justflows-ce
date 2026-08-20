# 01 — Justflows Core System License

**Applies to:** All source code in the Justflows monorepo that constitutes the core platform.

**License:** MIT License

**Full text:** [MIT.txt](./MIT.txt)

Justflows Core is licensed under the **MIT License**.

---

## Scope — what is "Core"

| Path / package | Description |
|---|---|
| `apps/server/` | Unified HTTP server (API, admin, installer, public site) |
| `packages/core/` | Application lifecycle, hooks, settings, health, config |
| `packages/database/` | Schema, migrations, database client |
| `packages/auth/` | Authentication and authorization |
| `packages/content/` | Content types, taxonomies, revisions |
| `packages/media/` | Media storage and delivery |
| `packages/blocks/` | Block runtime |
| `packages/installer/` | Browser installation wizard |
| `packages/updater/` | Update and package verification |
| `packages/cache/` | Caching layer |
| `packages/jobs/` | Background job runtime |
| `packages/cli/` | Command-line tools |
| `packages/plugin-api/` | Plugin runtime |
| `packages/sdk/` | Public SDK for extension developers |
| `docker/` | Official container definitions |
| `scripts/` | Build and release scripts |

Independently distributed plugins and themes are covered by [03-plugins.md](./03-plugins.md) and [04-themes.md](./04-themes.md). Develop local plugins in `plugins/<name>/`. Bundled examples (`plugins/hello-world/`, `themes/default/`) keep **their own declared license**, not MIT.

---

## Copyright notice

When distributing Justflows Core, preserve:

```
Copyright (c) 2026 Justflows Contributors
Licensed under the MIT License
See LICENSE and LICENSING.md
```

---

## Permissions (summary)

Under MIT you may:

1. **Use** — run Justflows for any purpose
2. **Modify** — change the source for your needs
3. **Distribute** — share copies with others
4. **Sell** — charge for copies, hosting, or support
5. **Sublicense** — include Justflows in a product under another license, provided the MIT notice is preserved

---

## Conditions (summary)

When you **distribute** Justflows Core (or a modified version), you **must**:

1. **Preserve notices** — include the MIT copyright notice and permission text
2. Keep the disclaimer intact

MIT does **not** require you to publish source for private modifications, proprietary products that include Justflows, or hosted services.

---

## Forks

You may fork Justflows. If you **distribute** your fork, preserve the MIT notice.

You **may not** use the **Justflows trademark** on your fork without permission.
See [08-trademark-support-warranty.md](./08-trademark-support-warranty.md).

---

## Enterprise modules

Optional enterprise features distributed **separately** from this MIT core may
use a commercial license. See [licenses/06-enterprise-license.md](./06-enterprise-license.md).

They must not be required to run basic Community Edition.

---

## How to comply when distributing

1. Include [MIT.txt](./MIT.txt), [LICENSE](../LICENSE), and [LICENSING.md](../LICENSING.md)
2. Preserve copyright and permission notices in source and substantial portions of the Software

---

## Contact

`legal@justflows.com`
