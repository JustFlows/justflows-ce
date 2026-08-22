-- Justflows persisted content type definitions — MySQL
-- Migration: 0005_content_types

CREATE TABLE IF NOT EXISTS content_types (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  site_id      CHAR(36)     NOT NULL,
  slug         VARCHAR(60)  NOT NULL,
  label        VARCHAR(255) NOT NULL,
  description  TEXT         NOT NULL,
  is_builtin   TINYINT(1)   NOT NULL DEFAULT 0,
  fields       JSON         NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_content_types (site_id, slug),
  KEY idx_content_types_site_id (site_id),
  CONSTRAINT fk_content_types_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
