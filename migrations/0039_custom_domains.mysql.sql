-- Custom domains: a site connects a hostname it owns. Rows that already exist
-- stay active, so domains an operator added by hand keep routing.
-- MySQL 8+ and MariaDB 10.6+ share this file.

ALTER TABLE site_domains ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE site_domains ADD COLUMN connect_mode VARCHAR(20) NULL;
ALTER TABLE site_domains ADD COLUMN verification_token VARCHAR(80) NULL;
ALTER TABLE site_domains ADD COLUMN parent_id CHAR(36) NULL;
ALTER TABLE site_domains ADD COLUMN provider VARCHAR(20) NULL;
ALTER TABLE site_domains ADD COLUMN dns_zone_id VARCHAR(40) NULL;
ALTER TABLE site_domains ADD COLUMN tls_status VARCHAR(20) NULL;
ALTER TABLE site_domains ADD COLUMN last_error VARCHAR(500) NULL;
ALTER TABLE site_domains ADD COLUMN check_failures INT NOT NULL DEFAULT 0;
ALTER TABLE site_domains ADD COLUMN checked_at DATETIME NULL;
ALTER TABLE site_domains ADD COLUMN verified_at DATETIME NULL;
ALTER TABLE site_domains ADD CONSTRAINT site_domains_status_check CHECK (status IN ('pending', 'active', 'failed'));

CREATE INDEX idx_site_domains_status ON site_domains(status);
CREATE INDEX idx_site_domains_parent ON site_domains(parent_id);

INSERT IGNORE INTO platform_settings (setting_key, value)
VALUES ('custom_domains', '{"enabled":false,"provider":"manual"}');
