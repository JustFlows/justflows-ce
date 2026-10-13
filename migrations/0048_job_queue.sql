-- Durable job queue: one row per enqueued run of a registered job (plugin
-- `ctx.jobs.enqueue`). Lives in the control database. A worker claims a due
-- row with a conditional update and keeps a lease while it runs; a row whose
-- lease ran out (its process died) is queued again. Done rows are pruned
-- after 7 days, failed rows after 30.

CREATE TABLE IF NOT EXISTS job_queue (
  id            UUID         PRIMARY KEY,
  job_name      VARCHAR(190) NOT NULL,
  site_id       UUID,
  payload       TEXT,
  status        VARCHAR(16)  NOT NULL,
  attempts      INTEGER      NOT NULL DEFAULT 0,
  max_attempts  INTEGER      NOT NULL DEFAULT 3,
  run_at        TIMESTAMPTZ  NOT NULL,
  locked_by     VARCHAR(64),
  locked_until  TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_job_queue_due ON job_queue(status, run_at);
CREATE INDEX IF NOT EXISTS idx_job_queue_name ON job_queue(job_name, status);
