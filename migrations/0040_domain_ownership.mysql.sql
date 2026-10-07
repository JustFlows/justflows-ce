-- Nameserver-mode custom domains prove ownership with a TXT challenge at the
-- domain's existing DNS before it is delegated to the platform. This records
-- when that proof was seen. Domains already active keep routing.
-- MySQL 8+ and MariaDB 10.6+ share this file.

ALTER TABLE site_domains ADD COLUMN ownership_proven_at DATETIME NULL;
UPDATE site_domains SET ownership_proven_at = CURRENT_TIMESTAMP WHERE status = 'active';
