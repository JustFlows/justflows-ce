-- Justflows CSS providers — MariaDB
-- Migration: 0003_css_providers

CREATE TABLE IF NOT EXISTS css_providers (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  site_id       CHAR(36)     NOT NULL,
  provider_id   VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  version       VARCHAR(50)  NOT NULL,
  publisher     VARCHAR(255) NOT NULL DEFAULT '',
  description   TEXT,
  status        ENUM('installed','active','inactive','error') NOT NULL DEFAULT 'installed',
  manifest      JSON         NOT NULL DEFAULT (JSON_OBJECT()),
  installed_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at  DATETIME,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_css_providers (site_id, provider_id),
  KEY idx_css_providers_site_id (site_id),
  KEY idx_css_providers_status (status),
  CONSTRAINT fk_css_providers_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
