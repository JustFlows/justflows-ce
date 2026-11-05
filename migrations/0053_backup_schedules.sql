CREATE TABLE IF NOT EXISTS backup_schedules (
  site_id UUID PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  frequency VARCHAR(16) NOT NULL DEFAULT 'daily',
  time_utc VARCHAR(5) NOT NULL DEFAULT '02:00',
  weekday SMALLINT NOT NULL DEFAULT 1,
  day_of_month SMALLINT NOT NULL DEFAULT 1,
  scope VARCHAR(16) NOT NULL DEFAULT 'root',
  destination VARCHAR(16) NOT NULL DEFAULT 's3',
  next_run_at TIMESTAMPTZ,
  last_job_id UUID,
  last_started_at TIMESTAMPTZ,
  last_finished_at TIMESTAMPTZ,
  last_status VARCHAR(16),
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_schedules_due ON backup_schedules(enabled, next_run_at);
