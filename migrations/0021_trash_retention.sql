-- Recoverable deletion for site-owned content.
ALTER TABLE content ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ;
ALTER TABLE content ADD COLUMN IF NOT EXISTS trashed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE content ADD COLUMN IF NOT EXISTS original_slug VARCHAR(1024);
ALTER TABLE content ADD COLUMN IF NOT EXISTS original_status content_status;

ALTER TABLE media ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ;
ALTER TABLE media ADD COLUMN IF NOT EXISTS trashed_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE comments ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS trashed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS original_status VARCHAR(20);

ALTER TABLE menus ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ;
ALTER TABLE menus ADD COLUMN IF NOT EXISTS trashed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE menus ADD COLUMN IF NOT EXISTS original_slug VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_content_trash ON content(site_id, trashed_at);
CREATE INDEX IF NOT EXISTS idx_media_trash ON media(site_id, trashed_at);
CREATE INDEX IF NOT EXISTS idx_comments_trash ON comments(site_id, trashed_at);
CREATE INDEX IF NOT EXISTS idx_menus_trash ON menus(site_id, trashed_at);
