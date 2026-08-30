-- Justflows public comments — MySQL
--
-- Adds opt-in reply notifications, an unsubscribe token, a moderator-edit
-- marker, and the indexes the public thread query and reply lookups need.
-- MySQL 8 has no ADD COLUMN / CREATE INDEX IF NOT EXISTS; the migration runner
-- treats "duplicate column" / "duplicate key name" as ignorable on re-run.

ALTER TABLE comments ADD COLUMN notify TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE comments ADD COLUMN unsubscribe_token VARCHAR(64) NULL;
ALTER TABLE comments ADD COLUMN edited_at DATETIME NULL;

CREATE INDEX idx_comments_thread
  ON comments (site_id, content_id, status, created_at);
CREATE INDEX idx_comments_parent
  ON comments (parent_id);
CREATE INDEX idx_comments_unsubscribe
  ON comments (unsubscribe_token);
