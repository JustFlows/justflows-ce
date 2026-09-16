-- Repair: on some MySQL/MariaDB installs, the `original_status` column that
-- 0021_trash_retention adds to `content` and `comments` silently failed to
-- apply (a duplicate-column error the migration runner treats as idempotent
-- masked a real failure). Duplicate-column errors are caught and ignored by
-- the runner, so this is a no-op on an install where it is already present.
ALTER TABLE content ADD COLUMN original_status VARCHAR(20) NULL;
ALTER TABLE comments ADD COLUMN original_status VARCHAR(20) NULL;
