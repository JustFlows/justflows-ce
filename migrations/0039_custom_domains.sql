-- Custom domains: a site connects a hostname it owns. Rows that already exist
-- stay active, so domains an operator added by hand keep routing.

ALTER TABLE site_domains ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE site_domains ADD COLUMN connect_mode VARCHAR(20);
ALTER TABLE site_domains ADD COLUMN verification_token VARCHAR(80);
ALTER TABLE site_domains ADD COLUMN parent_id UUID;
ALTER TABLE site_domains ADD COLUMN provider VARCHAR(20);
ALTER TABLE site_domains ADD COLUMN dns_zone_id VARCHAR(40);
ALTER TABLE site_domains ADD COLUMN tls_status VARCHAR(20);
ALTER TABLE site_domains ADD COLUMN last_error VARCHAR(500);
ALTER TABLE site_domains ADD COLUMN check_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE site_domains ADD COLUMN checked_at TIMESTAMPTZ;
ALTER TABLE site_domains ADD COLUMN verified_at TIMESTAMPTZ;
ALTER TABLE site_domains ADD CONSTRAINT site_domains_status_check CHECK (status IN ('pending', 'active', 'failed'));

CREATE INDEX IF NOT EXISTS idx_site_domains_status ON site_domains(status);
CREATE INDEX IF NOT EXISTS idx_site_domains_parent ON site_domains(parent_id);

INSERT INTO platform_settings (setting_key, value, updated_at)
SELECT 'custom_domains', '{"enabled":false,"provider":"manual"}'::jsonb, NOW()
WHERE NOT EXISTS (SELECT 1 FROM platform_settings WHERE setting_key = 'custom_domains');
