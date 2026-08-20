-- Justflows multilingual support
-- Migration: 0002_multilingual

BEGIN;

CREATE TABLE IF NOT EXISTS languages (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  code         VARCHAR(20)  NOT NULL,
  name         VARCHAR(100) NOT NULL,
  native_name  VARCHAR(100) NOT NULL,
  is_default   BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order   INT          NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, code)
);

CREATE INDEX IF NOT EXISTS idx_languages_site_id ON languages(site_id);

ALTER TABLE content ADD COLUMN IF NOT EXISTS locale VARCHAR(20) NOT NULL DEFAULT 'en';
ALTER TABLE content ADD COLUMN IF NOT EXISTS translation_group_id UUID;

-- Replace slug uniqueness to be per-locale
ALTER TABLE content DROP CONSTRAINT IF EXISTS content_site_id_type_slug_key;
ALTER TABLE content DROP CONSTRAINT IF EXISTS content_site_id_type_slug_locale_key;
ALTER TABLE content ADD CONSTRAINT content_site_id_type_slug_locale_key UNIQUE (site_id, type, slug, locale);

CREATE INDEX IF NOT EXISTS idx_content_locale ON content(locale);
CREATE INDEX IF NOT EXISTS idx_content_translation_group ON content(translation_group_id);

COMMIT;
