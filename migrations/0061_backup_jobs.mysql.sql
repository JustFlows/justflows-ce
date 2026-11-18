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
  id CHAR(36) PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  kind VARCHAR(20) NOT NULL,
  scope VARCHAR(20) NOT NULL DEFAULT 'site',
  status VARCHAR(16) NOT NULL DEFAULT 'running',
  progress INT NOT NULL DEFAULT 0,
  message VARCHAR(500),
  error TEXT,
  result_json MEDIUMTEXT,
  files_json TEXT,
  created_sites_json TEXT,
  rollback_json TEXT,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  worker VARCHAR(120),
  heartbeat_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_backup_jobs_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  INDEX idx_backup_jobs_site (site_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE backup_schedules ADD COLUMN passphrase_ciphertext TEXT NULL;
