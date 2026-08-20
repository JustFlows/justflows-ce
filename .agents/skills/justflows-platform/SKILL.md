---
name: justflows-platform
description: Plan and implement cross-cutting Justflows platform changes spanning packages, server, admin UI, extensions, or distribution. Use for architecture, feature placement, and end-to-end platform work; use a narrower Justflows skill for isolated tasks.
---

# Justflows Platform

Start by reading `AGENTS.md`, the affected package manifests, and existing implementation paths. Trace a feature from its stable domain contract through runtime integration and user-facing surfaces before choosing edit locations.

## Place responsibilities

- Put framework-neutral lifecycle, configuration, hooks, and health primitives in `packages/core`.
- Put public extension-facing types and contracts in `packages/sdk`; keep internal loaders and activation in `packages/plugin-api`.
- Put reusable domain behavior in the matching package and HTTP/session/view wiring in `apps/server`.
- Put administration interactions in `apps/server/admin-ui`; keep public rendering in server views/themes.
- Treat database, installation, update, cache invalidation, localization, and distribution impacts as explicit parts of cross-cutting features.

## Implement end to end

1. Identify existing contracts and compatibility expectations before changing them.
2. Add domain behavior and tests at the lowest owning layer.
3. Wire routes or middleware with authentication, capabilities, validation, and safe errors.
4. Update presentation, translations, and visible interaction states.
5. Update extension examples or docs when public behavior changes.
6. Run focused checks, then broader checks in proportion to impact.

Do not create duplicate abstractions to bypass package boundaries. Prefer established registries, services, hooks, and configuration schemas.
