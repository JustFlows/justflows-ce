-- 0013_public_comments
--
-- Public comment submission, moderation notifications, and threaded rendering.
-- The comments table already carries author/body/status/parent_id from the
-- baseline; this migration only adds opt-in reply notifications, a one-click
-- unsubscribe token, a moderator-edit marker, and the indexes the public
-- thread query and reply lookups need.

ALTER TABLE comments ADD COLUMN IF NOT EXISTS notify BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS unsubscribe_token VARCHAR(64);
ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_comments_thread
  ON comments (site_id, content_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent
  ON comments (parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_unsubscribe
  ON comments (unsubscribe_token);
