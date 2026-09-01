-- Justflows theme designs — MySQL
--
-- Per-theme Customizer mods / homepage / blog design documents move out of
-- site_settings into their own table. One row per (site, theme, kind).

CREATE TABLE IF NOT EXISTS theme_designs (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  site_id    CHAR(36)     NOT NULL,
  theme_id   VARCHAR(255) NOT NULL,
  kind       VARCHAR(40)  NOT NULL,
  doc        JSON         NOT NULL,
  draft_doc  JSON,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_theme_designs (site_id, theme_id, kind),
  KEY idx_theme_designs_site (site_id, theme_id),
  CONSTRAINT fk_theme_designs_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
