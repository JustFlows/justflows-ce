CREATE TABLE IF NOT EXISTS backup_schedules (
  site_id CHAR(36) PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  frequency VARCHAR(16) NOT NULL DEFAULT 'daily',
  time_utc VARCHAR(5) NOT NULL DEFAULT '02:00',
  weekday SMALLINT NOT NULL DEFAULT 1,
  day_of_month SMALLINT NOT NULL DEFAULT 1,
  scope VARCHAR(16) NOT NULL DEFAULT 'root',
  destination VARCHAR(16) NOT NULL DEFAULT 's3',
  next_run_at DATETIME(3),
  last_job_id CHAR(36),
  last_started_at DATETIME(3),
  last_finished_at DATETIME(3),
  last_status VARCHAR(16),
  last_error TEXT,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_backup_schedules_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  INDEX idx_backup_schedules_due (enabled, next_run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
