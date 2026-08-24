-- Justflows session revocation counter — mariadb
-- Migration: 0006_session_revocation
--
-- Session tokens are stateless HMACs, so logging out only clears the cookie and
-- a captured token stays valid for its full lifetime. This counter is embedded
-- in the token and compared on every request, which is what lets a password
-- change or an explicit "sign out everywhere" take effect immediately.
--
-- MySQL 8.0 has no ADD COLUMN IF NOT EXISTS; a duplicate-column error on re-run
-- is treated as ignorable by run-migrations.ts.

ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 0;
