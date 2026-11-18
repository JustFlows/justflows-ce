/**
 * Backup and restore jobs, visible to every worker. A request can reach any
 * process, so progress, cancellation, and the finished files cannot live in
 * one process's memory. Finished backup files are stored in private storage;
 * this row records where. A worker refreshes heartbeat_at while it runs, so a
 * job whose worker stopped is recognised and cleaned up.
 *
 * Automatic backups are encrypted like manual ones, so a schedule keeps its
 * passphrase, encrypted with the installation secret.
 */
CREATE TABLE IF NOT EXISTS backup_jobs (
  id UUID PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind VARCHAR(20) NOT NULL,
  scope VARCHAR(20) NOT NULL DEFAULT 'site',
  status VARCHAR(16) NOT NULL DEFAULT 'running',
  progress INTEGER NOT NULL DEFAULT 0,
  message VARCHAR(500),
  error TEXT,
  result_json TEXT,
  files_json TEXT,
  created_sites_json TEXT,
  rollback_json TEXT,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  worker VARCHAR(120),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_jobs_site ON backup_jobs(site_id, status);

ALTER TABLE backup_schedules ADD COLUMN passphrase_ciphertext TEXT NULL;
