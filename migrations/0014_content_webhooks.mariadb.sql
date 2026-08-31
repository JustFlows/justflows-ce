-- Justflows content webhooks — MariaDB

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id VARCHAR(36) PRIMARY KEY,
  site_id VARCHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  events TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_webhook_endpoints_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  INDEX idx_webhook_endpoints_site (site_id, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id VARCHAR(36) PRIMARY KEY,
  endpoint_id VARCHAR(36) NOT NULL,
  site_id VARCHAR(36) NOT NULL,
  event VARCHAR(160) NOT NULL,
  payload LONGTEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempt_count INT NOT NULL DEFAULT 0,
  response_status INT NULL,
  response_body VARCHAR(2048) NULL,
  error VARCHAR(1024) NULL,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_webhook_deliveries_endpoint FOREIGN KEY (endpoint_id) REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  CONSTRAINT fk_webhook_deliveries_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  INDEX idx_webhook_deliveries_due (status, next_attempt_at),
  INDEX idx_webhook_deliveries_endpoint (endpoint_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
