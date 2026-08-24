---
name: justflows-themes-blocks
description: Build or change Justflows themes, blocks, page rendering, block serialization, CSS providers, and visual customization. Use for public presentation and editor-to-renderer contracts.
---

# Justflows Themes and Blocks

Inspect `packages/blocks`, `themes/default`, `css-providers`, admin builder components, and the public rendering path relevant to the change.

- Keep block schemas, editor state, stored JSON, sanitation, and public rendering compatible as one contract.
- Give new fields safe defaults and preserve older content; migrations of stored block JSON must be explicit.
- Sanitize untrusted HTML and URLs at the authoritative rendering boundary.
- Themes must handle missing settings/content and must not assume a CSS provider unless declared.
- Preserve responsive output, semantic markup, keyboard accessibility, and visible focus.
- Keep provider-specific classes and assets inside their provider or theme boundary.
- Theme ids and `installedPath` values are untrusted. Resolve files only under `themes/` or `packages-installed/` via `resolvePathUnderBase`; do not `path.join` a raw id into `readFileSync`.
- Update previews and public output together.

Add serialization/rendering tests for meaningful schema changes and build affected packages plus admin/server surfaces.
