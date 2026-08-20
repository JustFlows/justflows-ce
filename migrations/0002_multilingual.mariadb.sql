-- Justflows multilingual support — MariaDB
-- Migration: 0002_multilingual

CREATE TABLE IF NOT EXISTS languages (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  site_id      CHAR(36)     NOT NULL,
  code         VARCHAR(20)  NOT NULL,
  name         VARCHAR(100) NOT NULL,
  native_name  VARCHAR(100) NOT NULL,
  is_default   TINYINT(1)   NOT NULL DEFAULT 0,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order   INT          NOT NULL DEFAULT 0,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_languages_site_code (site_id, code),
  KEY idx_languages_site_id (site_id),
  CONSTRAINT fk_languages_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE content ADD COLUMN locale VARCHAR(20) NOT NULL DEFAULT 'en';
ALTER TABLE content ADD COLUMN translation_group_id CHAR(36) NULL;

ALTER TABLE content DROP INDEX uq_content_slug;
ALTER TABLE content ADD UNIQUE KEY uq_content_slug_locale (site_id, type, slug(200), locale);
ALTER TABLE content ADD KEY idx_content_locale (locale);
ALTER TABLE content ADD KEY idx_content_translation_group (translation_group_id);
