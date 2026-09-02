-- Justflows theme template overrides — MySQL and MariaDB
--
-- Per-site edited copies of a theme's `templates/<slug>.json`. One row per
-- (site, theme, slug); `doc` is published, `draft_doc` the working copy.

CREATE TABLE IF NOT EXISTS theme_templates (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  site_id    CHAR(36)     NOT NULL,
  theme_id   VARCHAR(255) NOT NULL,
  slug       VARCHAR(120) NOT NULL,
  doc        JSON         NOT NULL,
  draft_doc  JSON,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_theme_templates (site_id, theme_id, slug),
  KEY idx_theme_templates_site (site_id, theme_id),
  CONSTRAINT fk_theme_templates_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
