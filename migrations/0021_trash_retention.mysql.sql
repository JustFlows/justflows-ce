-- Recoverable deletion for site-owned content (MySQL and MariaDB).
ALTER TABLE content ADD COLUMN trashed_at DATETIME NULL;
ALTER TABLE content ADD COLUMN trashed_by CHAR(36) NULL;
ALTER TABLE content ADD COLUMN original_slug VARCHAR(1024) NULL;
ALTER TABLE content ADD COLUMN original_status VARCHAR(20) NULL;
ALTER TABLE content ADD CONSTRAINT fk_content_trashed_by FOREIGN KEY (trashed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE media ADD COLUMN trashed_at DATETIME NULL;
ALTER TABLE media ADD COLUMN trashed_by CHAR(36) NULL;
ALTER TABLE media ADD CONSTRAINT fk_media_trashed_by FOREIGN KEY (trashed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE comments ADD COLUMN trashed_at DATETIME NULL;
ALTER TABLE comments ADD COLUMN trashed_by CHAR(36) NULL;
ALTER TABLE comments ADD COLUMN original_status VARCHAR(20) NULL;
ALTER TABLE comments ADD CONSTRAINT fk_comments_trashed_by FOREIGN KEY (trashed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE menus ADD COLUMN trashed_at DATETIME NULL;
ALTER TABLE menus ADD COLUMN trashed_by CHAR(36) NULL;
ALTER TABLE menus ADD COLUMN original_slug VARCHAR(255) NULL;
ALTER TABLE menus ADD CONSTRAINT fk_menus_trashed_by FOREIGN KEY (trashed_by) REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_content_trash ON content(site_id, trashed_at);
CREATE INDEX idx_media_trash ON media(site_id, trashed_at);
CREATE INDEX idx_comments_trash ON comments(site_id, trashed_at);
CREATE INDEX idx_menus_trash ON menus(site_id, trashed_at);
