-- Justflows persisted content type definitions
-- Migration: 0005_content_types

BEGIN;

CREATE TABLE IF NOT EXISTS content_types (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug         VARCHAR(60)  NOT NULL,
  label        VARCHAR(255) NOT NULL,
  description  TEXT         NOT NULL DEFAULT '',
  is_builtin   BOOLEAN      NOT NULL DEFAULT FALSE,
  fields       JSONB        NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_content_types_site_id ON content_types(site_id);

COMMIT;
