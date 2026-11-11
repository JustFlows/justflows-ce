-- WebAuthn passkeys for administrators and users (#105).
--
-- One row per registered credential. Only the public key is stored, as the
-- COSE key the authenticator returned; there is no shared secret to protect.
-- credential_hash is the SHA-256 of the raw credential id, so the unique index
-- stays small however long an authenticator makes its ids (up to 1023 bytes).
-- site_id is the account's home site (users.site_id).
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id                 UUID         PRIMARY KEY,
  user_id            UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id            UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  credential_hash    CHAR(64)     NOT NULL UNIQUE,
  credential_id      TEXT         NOT NULL,
  public_key         TEXT         NOT NULL,
  algorithm          INTEGER      NOT NULL,
  sign_count         BIGINT       NOT NULL DEFAULT 0,
  transports         VARCHAR(255),
  aaguid             CHAR(36),
  attestation_format VARCHAR(32)  NOT NULL DEFAULT 'none',
  backup_eligible    BOOLEAN      NOT NULL DEFAULT FALSE,
  backup_state       BOOLEAN      NOT NULL DEFAULT FALSE,
  name               VARCHAR(100) NOT NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_used_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials(user_id, site_id);

-- Outstanding registration and sign-in challenges. Each row is claimed by
-- deleting it, so a challenge is accepted once, on whichever worker sees it
-- first. user_id is NULL for a passwordless sign-in, where the account is only
-- known once the authenticator answers.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id          CHAR(64)     PRIMARY KEY,
  site_id     UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id     UUID         REFERENCES users(id) ON DELETE CASCADE,
  purpose     VARCHAR(16)  NOT NULL,
  challenge   VARCHAR(128) NOT NULL,
  rp_id       VARCHAR(253) NOT NULL,
  origin      VARCHAR(300) NOT NULL,
  expires_at  TIMESTAMPTZ  NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges(expires_at);
