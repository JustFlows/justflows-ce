-- Record when this installation attached a custom domain's hostname at the
-- provider, so removing a claim only detaches what this claim attached.
-- Domains that were ever verified (and so went through attachment) are
-- treated as attached.

ALTER TABLE site_domains ADD COLUMN provider_attached_at TIMESTAMPTZ;
UPDATE site_domains SET provider_attached_at = NOW()
WHERE kind = 'custom' AND provider IS NOT NULL AND (status = 'active' OR verified_at IS NOT NULL);
