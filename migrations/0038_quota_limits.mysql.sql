-- Workspace and site quotas. A missing row means unlimited.
-- MySQL 8+ and MariaDB 10.6+ share this file.

CREATE TABLE IF NOT EXISTS quota_limits (
  scope       VARCHAR(20) NOT NULL,
  scope_id    CHAR(36) NOT NULL,
  meter_key   VARCHAR(120) NOT NULL,
  limit_value BIGINT NOT NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, scope_id, meter_key),
  CONSTRAINT quota_limits_scope_check CHECK (scope IN ('workspace', 'site')),
  CONSTRAINT quota_limits_value_check CHECK (limit_value >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
