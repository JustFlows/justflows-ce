---
name: justflows-extensions
description: Develop or change Justflows plugins, the public SDK, plugin runtime, manifests, hooks, permissions, packaging, and extension examples. Use for extension-facing contracts and .jfpkg behavior.
---

# Justflows Extensions

Read `packages/sdk`, `packages/plugin-api`, `packages/installer`, `docs/HOOKS.md`, `LICENSING.md`, `plugins/README.md`, and `plugins/hello-world` as relevant.

- New plugins are created as `plugins/<name>/` in this repository (copy `plugins/hello-world`). Do not put plugin source under `packages/`.
- Treat `@justflows/sdk` as a versioned public contract. Prefer additive changes and preserve source/runtime compatibility.
- Keep privileged internals out of SDK contexts. Expose narrow capabilities and enforce declared permissions.
- Isolate and observe activation/deactivation failure; one extension must not crash platform startup.
- Validate package paths, archive entries, sizes, entrypoints, identifiers, versions, and declared license metadata (Marketplace listings must be GPL-compatible).
- Define hook payloads and timing clearly. Avoid mutable shared payloads unless a filter contract requires them.
- Update the canonical example and hook documentation when public usage changes.

Test invalid manifests, missing permissions, load failures, lifecycle cleanup, and compatibility. Check SDK, plugin API, installer, and example plugin when their contracts are touched.
