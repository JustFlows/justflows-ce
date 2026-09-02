-- 0020_email_delivery — outbound email operations (#104), MySQL and MariaDB
CREATE TABLE IF NOT EXISTS email_deliveries (
  id CHAR(36) NOT NULL PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  message_type VARCHAR(80) NOT NULL,
  recipient_masked VARCHAR(320) NOT NULL,
  recipient_hash VARCHAR(64) NOT NULL,
  recipient_encrypted TEXT NOT NULL,
  message_encrypted TEXT NOT NULL,
  subject VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL,
  transport VARCHAR(120) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  provider_response TEXT,
  error_detail TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME,
  next_attempt_at DATETIME,
  KEY idx_email_deliveries_site_created (site_id, created_at),
  KEY idx_email_deliveries_retry (status, next_attempt_at),
  CONSTRAINT fk_email_deliveries_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_suppressions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  email_hash VARCHAR(64) NOT NULL,
  email_masked VARCHAR(320) NOT NULL,
  message_type VARCHAR(80) NOT NULL,
  reason VARCHAR(500),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email_suppressions (site_id, email_hash, message_type),
  CONSTRAINT fk_email_suppressions_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
