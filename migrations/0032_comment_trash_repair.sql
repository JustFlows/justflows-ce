-- Repair: on some MySQL/MariaDB installs, the `original_status` column that
-- 0021_trash_retention adds to `content` and `comments` silently failed to
-- apply (a duplicate-column error the migration runner treats as idempotent
-- masked a real failure). This is a no-op on an install where the column is
-- already present.
ALTER TABLE content ADD COLUMN IF NOT EXISTS original_status content_status;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS original_status VARCHAR(20);
