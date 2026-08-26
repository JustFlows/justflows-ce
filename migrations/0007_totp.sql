-- Justflows two-factor authentication (TOTP)
-- Migration: 0007_totp
--
-- An administrator who can upload a .jfpkg or a core .zip can run code on the
-- server, so a single password is the only thing in front of shell access.
-- Rate limiting slows online guessing but does nothing against a reused
-- password from a breach corpus, or a phishing page.
--
-- The secret is stored encrypted (secret-box, AES-256-GCM under a key derived
-- from APP_SECRET), so a database backup does not hand over working seeds.
-- totp_confirmed_at stays NULL until the user proves they can generate a code,
-- which is what stops an interrupted enrolment from locking someone out.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_confirmed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery_codes TEXT;

COMMIT;
