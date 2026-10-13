-- Durable job queue: one row per enqueued run of a registered job (plugin
-- `ctx.jobs.enqueue`). Lives in the control database. A worker claims a due
-- row with a conditional update and keeps a lease while it runs; a row whose
-- lease ran out (its process died) is queued again. Done rows are pruned
-- after 7 days, failed rows after 30.
-- MySQL 8+ and MariaDB 10.6+ share this file.

CREATE TABLE IF NOT EXISTS job_queue (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  job_name      VARCHAR(190) NOT NULL,
  site_id       CHAR(36)     NULL,
  payload       MEDIUMTEXT   NULL,
  status        VARCHAR(16)  NOT NULL,
  attempts      INT          NOT NULL DEFAULT 0,
  max_attempts  INT          NOT NULL DEFAULT 3,
  run_at        DATETIME(3)  NOT NULL,
  locked_by     VARCHAR(64)  NULL,
  locked_until  DATETIME(3)  NULL,
  last_error    TEXT         NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  finished_at   DATETIME     NULL,
  KEY idx_job_queue_due (status, run_at),
  KEY idx_job_queue_name (job_name, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
