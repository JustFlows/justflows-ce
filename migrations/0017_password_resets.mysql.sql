-- Justflows self-service password recovery — MySQL and MariaDB
--
-- One row per outstanding "forgot password" request (#93). Only the SHA-256 hash
-- of the single-use token is stored; the token itself is mailed to the account
-- and never persisted. Rows are single-use (used_at), time-limited (expires_at),
-- bound to one account, and cleared on a successful reset or any password
-- change. Neither engine has CREATE INDEX IF NOT EXISTS; the migration runner
-- treats "table already exists" / "duplicate key name" as ignorable on re-run.
-- MariaDB reuses this file (see migrationFileCandidates in run-migrations.ts).

CREATE TABLE IF NOT EXISTS password_resets (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  user_id      CHAR(36)     NOT NULL,
  site_id      CHAR(36)     NOT NULL,
  token_hash   CHAR(64)     NOT NULL,
  requested_ip VARCHAR(64),
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME     NOT NULL,
  used_at      DATETIME,
  UNIQUE KEY uq_password_resets_token (token_hash),
  KEY idx_password_resets_user (user_id),
  KEY idx_password_resets_expires (expires_at),
  CONSTRAINT fk_password_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_password_resets_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
