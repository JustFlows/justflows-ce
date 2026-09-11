-- Revocable API keys for the headless federated management API (#135) — MySQL
-- and MariaDB. See 0026_api_keys.sql for column semantics. MySQL 8 has no
-- ADD COLUMN IF NOT EXISTS; the migration runner treats "duplicate column" as
-- ignorable on re-run (same idiom as 0024_menu_designer.mysql.sql).

CREATE TABLE IF NOT EXISTS api_keys (
  id VARCHAR(36) PRIMARY KEY,
  site_id VARCHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  key_prefix VARCHAR(16) NOT NULL,
  key_hash VARCHAR(128) NOT NULL UNIQUE,
  owner_user_id VARCHAR(36) NOT NULL,
  created_by VARCHAR(36) NOT NULL,
  capabilities_json TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  allowed_ips_json TEXT NOT NULL,
  allowed_origins_json TEXT NOT NULL,
  rate_limit_per_min INT NULL,
  expires_at DATETIME NULL,
  revoked_at DATETIME NULL,
  last_used_at DATETIME NULL,
  last_used_ip VARCHAR(64) NULL,
  request_count BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_api_keys_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_api_keys_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_api_keys_site (site_id),
  INDEX idx_api_keys_owner (owner_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE webhook_endpoints ADD COLUMN api_key_id VARCHAR(36) NULL;
