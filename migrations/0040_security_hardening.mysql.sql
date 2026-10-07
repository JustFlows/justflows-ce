-- Security hardening for shared installations.
--
-- Nameserver-mode custom domains prove ownership with a TXT challenge at the
-- domain's existing DNS before it is delegated to the platform. This records
-- when that proof was seen. Domains already active keep routing.
-- MySQL 8+ and MariaDB 10.6+ share this file.

ALTER TABLE site_domains ADD COLUMN ownership_proven_at DATETIME NULL;
UPDATE site_domains SET ownership_proven_at = CURRENT_TIMESTAMP WHERE status = 'active';

-- Storage used by an image's generated variants, so library limits count
-- everything an upload puts on disk, not only the original file.
ALTER TABLE media ADD COLUMN derivative_bytes BIGINT NOT NULL DEFAULT 0;
