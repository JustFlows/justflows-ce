-- Justflows working content revisions
-- Migration: 0010_content_revisions
--
-- Published content keeps its row as the live snapshot. Saves write a single
-- working revision until an explicit publish copies it onto the live row.

BEGIN;

ALTER TABLE content ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

ALTER TABLE revisions ADD COLUMN IF NOT EXISTS slug VARCHAR(1024) NOT NULL DEFAULT '';
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS excerpt TEXT;
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS locale VARCHAR(20);
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS translation_group_id UUID;
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'historical';
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual';
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS base_version INT NOT NULL DEFAULT 1;
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_revisions_working
  ON revisions (content_id) WHERE kind = 'working';
CREATE UNIQUE INDEX IF NOT EXISTS uq_revisions_autosave
  ON revisions (content_id) WHERE kind = 'autosave';
CREATE INDEX IF NOT EXISTS idx_revisions_kind_created
  ON revisions (content_id, kind, created_at DESC);

COMMIT;
