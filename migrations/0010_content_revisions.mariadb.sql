-- Justflows working content revisions — MariaDB
-- Migration: 0010_content_revisions
--
-- Do not ADD FOREIGN KEY or STORED generated unique columns on `revisions`.
-- InnoDB copies the table for those ALTERs and then fails with
-- errno 121 ("Duplicate key on write or update") because the existing
-- fk_revisions_* names from 0001_initial are already in the dictionary.
-- One working/autosave row per content item is enforced in application
-- upserts; PostgreSQL keeps partial unique indexes for the same invariant.

ALTER TABLE content ADD COLUMN version INT NOT NULL DEFAULT 1;

ALTER TABLE revisions ADD COLUMN slug VARCHAR(1024) NOT NULL DEFAULT '';
ALTER TABLE revisions ADD COLUMN excerpt TEXT;
ALTER TABLE revisions ADD COLUMN locale VARCHAR(20);
ALTER TABLE revisions ADD COLUMN translation_group_id CHAR(36);
ALTER TABLE revisions ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'historical';
ALTER TABLE revisions ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'manual';
ALTER TABLE revisions ADD COLUMN base_version INT NOT NULL DEFAULT 1;
ALTER TABLE revisions ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE revisions ADD COLUMN updated_by CHAR(36);
ALTER TABLE revisions ADD KEY idx_revisions_kind_created (content_id, kind, created_at);
