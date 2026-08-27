-- Justflows working content revisions — MariaDB
-- Migration: 0010_content_revisions

ALTER TABLE content ADD COLUMN version INT NOT NULL DEFAULT 1;

ALTER TABLE revisions ADD COLUMN slug VARCHAR(1024) NOT NULL DEFAULT '';
ALTER TABLE revisions ADD COLUMN excerpt TEXT;
ALTER TABLE revisions ADD COLUMN locale VARCHAR(20);
ALTER TABLE revisions ADD COLUMN translation_group_id CHAR(36);
ALTER TABLE revisions ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'historical';
ALTER TABLE revisions ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'manual';
ALTER TABLE revisions ADD COLUMN base_version INT NOT NULL DEFAULT 1;
ALTER TABLE revisions ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE revisions ADD COLUMN updated_by CHAR(36);
ALTER TABLE revisions ADD CONSTRAINT fk_revisions_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE revisions ADD COLUMN working_slot CHAR(36) GENERATED ALWAYS AS (IF(`kind` = 'working', `content_id`, NULL)) STORED;
ALTER TABLE revisions ADD COLUMN autosave_slot CHAR(36) GENERATED ALWAYS AS (IF(`kind` = 'autosave', `content_id`, NULL)) STORED;
CREATE UNIQUE INDEX uq_revisions_working ON revisions (working_slot);
CREATE UNIQUE INDEX uq_revisions_autosave ON revisions (autosave_slot);
ALTER TABLE revisions ADD KEY idx_revisions_kind_created (content_id, kind, created_at);
