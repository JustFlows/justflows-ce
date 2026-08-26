-- Justflows two-factor authentication (TOTP) — mariadb
-- Migration: 0007_totp
--
-- An administrator who can upload a .jfpkg or a core .zip can run code on the
-- server, so a single password is the only thing in front of shell access.
--
-- The secret is stored encrypted (secret-box, AES-256-GCM under a key derived
-- from APP_SECRET). totp_confirmed_at stays NULL until the user proves they can
-- generate a code, so an interrupted enrolment cannot lock anyone out.
--
-- MySQL 8.0 has no ADD COLUMN IF NOT EXISTS; a duplicate-column error on re-run
-- is treated as ignorable by run-migrations.ts.

ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_confirmed_at DATETIME NULL;
ALTER TABLE users ADD COLUMN totp_recovery_codes TEXT;
