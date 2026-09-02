-- 0015_theme_designs
-- Per-theme customization documents (Customizer mods, homepage design, blog
-- design) are design artifacts, not site preferences — they get their own table
-- instead of living as JSON rows in site_settings (theme_mods.*, theme_home.*,
-- theme_blog.* and their *_draft.* siblings). One row per (site, theme, kind):
-- `doc` is the published document, `draft_doc` the unpublished working copy
-- (NULL when none). The old site_settings rows are copied over and removed by a
-- one-time application backfill on boot (see theme-designs-migrate.ts).

CREATE TABLE IF NOT EXISTS theme_designs (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  theme_id   VARCHAR(255) NOT NULL,
  kind       VARCHAR(40)  NOT NULL,
  doc        JSONB        NOT NULL DEFAULT '{}',
  draft_doc  JSONB,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, theme_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_theme_designs_site ON theme_designs(site_id, theme_id);
