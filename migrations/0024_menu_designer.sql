-- 0024_menu_designer
-- Adds the menu designer's layout/design contract and a draft/publish split to
-- `menus`, mirroring the `theme_templates`/`theme_designs` draft_doc pattern:
-- `design` holds the published layout/design config (layout kind, activation,
-- breakpoint, columns, theme-token overrides, ...), `draft_items`/
-- `draft_design` hold an unpublished working copy the admin preview iframe
-- reads, and `schema_version` lets menu-item resolution evolve without
-- breaking rows written by an older core version. A NULL/empty `design`
-- means "use the built-in defaults" (parsed leniently, like `items` already
-- is), so every existing menu keeps rendering exactly as before.

ALTER TABLE menus ADD COLUMN IF NOT EXISTS design JSONB;
ALTER TABLE menus ADD COLUMN IF NOT EXISTS draft_items JSONB;
ALTER TABLE menus ADD COLUMN IF NOT EXISTS draft_design JSONB;
ALTER TABLE menus ADD COLUMN IF NOT EXISTS schema_version INT NOT NULL DEFAULT 1;
