-- 0023_templates
-- Per-site overrides of a theme's template-hierarchy files (Theme builder →
-- Templates). When an editor customises `templates/<slug>.json` the edited
-- block document lives here rather than in the theme package, so it survives
-- theme updates and can be reset. One row per (site, theme, slug): `doc` is the
-- published document, `draft_doc` the unpublished working copy (NULL when
-- none). No row means "use the theme's own templates/<slug>.json", and failing
-- that the built-in view.

CREATE TABLE IF NOT EXISTS theme_templates (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  theme_id   VARCHAR(255) NOT NULL,
  slug       VARCHAR(120) NOT NULL,
  doc        JSONB        NOT NULL DEFAULT '{}',
  draft_doc  JSONB,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, theme_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_theme_templates_site ON theme_templates(site_id, theme_id);
