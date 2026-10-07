-- Security hardening for shared installations.
--
-- Nameserver-mode custom domains prove ownership with a TXT challenge at the
-- domain's existing DNS before it is delegated to the platform. This records
-- when that proof was seen. Domains already active keep routing.

ALTER TABLE site_domains ADD COLUMN ownership_proven_at TIMESTAMPTZ;
UPDATE site_domains SET ownership_proven_at = NOW() WHERE status = 'active';

-- Storage used by an image's generated variants, so library limits count
-- everything an upload puts on disk, not only the original file.
ALTER TABLE media ADD COLUMN derivative_bytes BIGINT NOT NULL DEFAULT 0;
