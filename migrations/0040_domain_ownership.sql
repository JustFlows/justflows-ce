-- Nameserver-mode custom domains prove ownership with a TXT challenge at the
-- domain's existing DNS before it is delegated to the platform. This records
-- when that proof was seen. Domains already active keep routing.

ALTER TABLE site_domains ADD COLUMN ownership_proven_at TIMESTAMPTZ;
UPDATE site_domains SET ownership_proven_at = NOW() WHERE status = 'active';
