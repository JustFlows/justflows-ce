-- 0017_password_resets
-- Self-service password recovery for administrators and users (#93).
--
-- One row per outstanding "forgot password" request. The link mailed to the
-- account carries a high-entropy token; only its SHA-256 hash is stored here, so
-- a database backup, a read-only injection or a support export never yields a
-- usable reset link. A row is single-use (used_at is stamped on redemption),
-- time-limited (expires_at), and bound to one account. Every row for a user is
-- deleted on a successful reset, on any password change, and on demand once
-- expired, so the table stays small and a captured-but-unused link cannot be
-- combined with a later one.

CREATE TABLE IF NOT EXISTS password_resets (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id      UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  -- SHA-256 hex digest of the single-use token. Never the token itself.
  token_hash   CHAR(64)     NOT NULL UNIQUE,
  -- Coarse origin of the request, for the audit trail and abuse triage only.
  requested_ip VARCHAR(64),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ  NOT NULL,
  used_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON password_resets(expires_at);
