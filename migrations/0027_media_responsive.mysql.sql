-- MySQL and MariaDB equivalent of 0027_media_responsive.sql.
-- ADD COLUMN has no portable IF NOT EXISTS on MySQL 8; the migration runner
-- treats the "duplicate column" error as idempotent on re-run.
ALTER TABLE media ADD COLUMN focal_x DOUBLE NULL;
ALTER TABLE media ADD COLUMN focal_y DOUBLE NULL;
ALTER TABLE media ADD COLUMN original_format VARCHAR(16) NULL;
ALTER TABLE media ADD COLUMN variants_generated_at DATETIME NULL;

-- `url` is TEXT, so the composite index needs a key-length prefix.
CREATE INDEX idx_media_site_url ON media (site_id, url(191));
