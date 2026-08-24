-- Justflows session revocation counter
-- Migration: 0006_session_revocation
--
-- Session tokens are stateless HMACs, so logging out only clears the cookie and
-- a captured token stays valid for its full lifetime. This counter is embedded
-- in the token and compared on every request, which is what lets a password
-- change or an explicit "sign out everywhere" take effect immediately.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

COMMIT;
