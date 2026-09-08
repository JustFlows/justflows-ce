-- MySQL and MariaDB equivalent of 0025_redirect_manager.sql.
CREATE TABLE IF NOT EXISTS redirects (
  id CHAR(36) PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  rule TEXT NOT NULL,
  INDEX idx_redirects_site (site_id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS redirect_not_found (
  site_id CHAR(36) NOT NULL,
  path_hash VARCHAR(64) NOT NULL,
  path VARCHAR(2048) NOT NULL,
  hits BIGINT NOT NULL DEFAULT 1,
  referrer VARCHAR(512) NOT NULL DEFAULT '',
  first_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, path_hash),
  INDEX idx_redirect_not_found_seen (site_id, last_seen),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
