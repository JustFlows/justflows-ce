-- Justflows administrative audit log — mysql
-- Migration: 0008_audit_log
--
-- There was no record of who signed in, who changed a role, who uploaded a
-- package or who altered the security-header policy. For an administrator role
-- the project documents as equivalent to shell access, that means a compromise
-- cannot be reconstructed afterwards.
--
-- actor_id is intentionally NOT a foreign key: deleting a user must not delete
-- the record of what that user did.

CREATE TABLE IF NOT EXISTS audit_log (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  site_id     CHAR(36)     NOT NULL,
  occurred_at DATETIME     NOT NULL,
  action      VARCHAR(64)  NOT NULL,
  outcome     VARCHAR(16)  NOT NULL DEFAULT 'success',
  actor_id    CHAR(36)     NULL,
  actor_email VARCHAR(320) NULL,
  actor_role  VARCHAR(32)  NULL,
  target      VARCHAR(255) NULL,
  ip          VARCHAR(64)  NULL,
  user_agent  VARCHAR(255) NULL,
  detail      TEXT         NULL,
  KEY idx_audit_log_site_time (site_id, occurred_at),
  KEY idx_audit_log_action (site_id, action),
  CONSTRAINT fk_audit_log_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
