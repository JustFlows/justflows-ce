-- Justflows administrative audit log
-- Migration: 0008_audit_log
--
-- There was no record of who signed in, who changed a role, who uploaded a
-- package or who altered the security-header policy. For an administrator role
-- the project documents as equivalent to shell access, that means a compromise
-- cannot be reconstructed afterwards — which is the point at which anyone asks.
--
-- Append-only by convention: nothing in the application updates or deletes a
-- row except the retention sweep, which drops entries past their age limit.
--
-- actor_id is intentionally NOT a foreign key. Deleting a user must not delete
-- the record of what that user did, and ON DELETE SET NULL would erase the one
-- detail the entry exists to carry.

BEGIN;

CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  action      VARCHAR(64)  NOT NULL,
  outcome     VARCHAR(16)  NOT NULL DEFAULT 'success',
  actor_id    UUID,
  actor_email VARCHAR(320),
  actor_role  VARCHAR(32),
  target      VARCHAR(255),
  ip          VARCHAR(64),
  user_agent  VARCHAR(255),
  detail      TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_site_time ON audit_log(site_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(site_id, action);

COMMIT;
