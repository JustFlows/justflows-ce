-- Repair audit_log installations upgraded from the legacy 0001 schema.
-- 0008 used CREATE TABLE IF NOT EXISTS, so it could not add its newer columns
-- when the old table was already present. Keep the legacy columns and data;
-- runtime writes explicitly populate the legacy metadata column as well.

BEGIN;

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS outcome VARCHAR(16) NOT NULL DEFAULT 'success';
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_id UUID;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_email VARCHAR(320);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_role VARCHAR(32);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip VARCHAR(64);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_agent VARCHAR(255);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS detail TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

UPDATE audit_log
SET occurred_at = COALESCE(occurred_at, created_at, NOW()),
    actor_id = COALESCE(actor_id, user_id),
    ip = COALESCE(ip, ip_address)
WHERE occurred_at IS NULL OR actor_id IS NULL OR ip IS NULL;
ALTER TABLE audit_log ALTER COLUMN occurred_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_site_time ON audit_log(site_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(site_id, action);

COMMIT;
