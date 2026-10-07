-- Record when this installation attached a custom domain's hostname at the
-- provider, so removing a claim only detaches what this claim attached.
-- Domains that were ever verified (and so went through attachment) are
-- treated as attached.
-- MySQL 8+ and MariaDB 10.6+ share this file.

ALTER TABLE site_domains ADD COLUMN provider_attached_at DATETIME NULL;
UPDATE site_domains SET provider_attached_at = CURRENT_TIMESTAMP
WHERE kind = 'custom' AND provider IS NOT NULL AND (status = 'active' OR verified_at IS NOT NULL);
