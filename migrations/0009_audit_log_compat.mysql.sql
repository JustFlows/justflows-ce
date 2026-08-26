-- Repair audit_log installations upgraded from the legacy 0001 schema.
-- Statements are intentionally separate: the migration runner ignores a
-- duplicate-column error when 0008 already created the new table shape.

ALTER TABLE audit_log ADD COLUMN occurred_at DATETIME NULL;
ALTER TABLE audit_log ADD COLUMN outcome VARCHAR(16) NOT NULL DEFAULT 'success';
ALTER TABLE audit_log ADD COLUMN actor_id CHAR(36) NULL;
ALTER TABLE audit_log ADD COLUMN actor_email VARCHAR(320) NULL;
ALTER TABLE audit_log ADD COLUMN actor_role VARCHAR(32) NULL;
ALTER TABLE audit_log ADD COLUMN ip VARCHAR(64) NULL;
ALTER TABLE audit_log ADD COLUMN user_agent VARCHAR(255) NULL;
ALTER TABLE audit_log ADD COLUMN detail TEXT NULL;
ALTER TABLE audit_log ADD COLUMN metadata JSON NULL;
ALTER TABLE audit_log ADD COLUMN user_id CHAR(36) NULL;
ALTER TABLE audit_log ADD COLUMN ip_address VARCHAR(64) NULL;
ALTER TABLE audit_log ADD COLUMN created_at DATETIME NULL;

UPDATE audit_log
SET occurred_at = COALESCE(occurred_at, created_at, CURRENT_TIMESTAMP),
    actor_id = COALESCE(actor_id, user_id),
    ip = COALESCE(ip, ip_address)
WHERE occurred_at IS NULL OR actor_id IS NULL OR ip IS NULL;
ALTER TABLE audit_log MODIFY occurred_at DATETIME NOT NULL;

ALTER TABLE audit_log ADD KEY idx_audit_log_site_time (site_id, occurred_at);
ALTER TABLE audit_log ADD KEY idx_audit_log_action (site_id, action);
