-- Menu designer layout/design contract and draft/publish split (MySQL and
-- MariaDB). See 0024_menu_designer.sql for the column semantics. MySQL 8 has
-- no ADD COLUMN IF NOT EXISTS; the migration runner treats "duplicate column"
-- as ignorable on re-run (same idiom as 0021_trash_retention.mysql.sql).
ALTER TABLE menus ADD COLUMN design JSON NULL;
ALTER TABLE menus ADD COLUMN draft_items JSON NULL;
ALTER TABLE menus ADD COLUMN draft_design JSON NULL;
ALTER TABLE menus ADD COLUMN schema_version INT NOT NULL DEFAULT 1;
