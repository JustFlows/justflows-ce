---
name: justflows-admin-ui
description: Create or change the Justflows React and Vite administration interface, including pages, forms, builders, API calls, styles, and admin localization. Use for apps/server/admin-ui work.
---

# Justflows Admin UI

Inspect the target page and nearby components before introducing patterns. Follow existing routing, API client, form, notification, and CSS conventions in `apps/server/admin-ui`.

- Keep server authority on the server; UI gating does not replace capability checks.
- Model loading, empty, success, validation, and recoverable error states.
- Preserve keyboard access, labels, focus visibility, semantic controls, and useful disabled states.
- Route visible strings through the existing i18n catalogs and update the embedded English fallback when required.
- Avoid unsafe HTML. Preview block or theme output through the platform sanitation/rendering path.
- Keep pages orchestration-focused and extract components only for cohesive reuse.
- Check responsive behavior in tables, editors, modals, and settings layouts.

When an API shape changes, update server and client together and handle non-2xx responses explicitly. Verify the admin build and server typecheck; inspect changed interaction states when practical.
