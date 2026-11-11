-- WebAuthn passkeys for administrators and users (#105). MySQL and MariaDB.
--
-- One row per registered credential. Only the public key is stored, as the
-- COSE key the authenticator returned; there is no shared secret to protect.
-- credential_hash is the SHA-256 of the raw credential id, so the unique index
-- stays small however long an authenticator makes its ids (up to 1023 bytes).
-- site_id is the account's home site (users.site_id).
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id                 CHAR(36)     NOT NULL PRIMARY KEY,
  user_id            CHAR(36)     NOT NULL,
  site_id            CHAR(36)     NOT NULL,
  credential_hash    CHAR(64)     NOT NULL,
  credential_id      TEXT         NOT NULL,
  public_key         TEXT         NOT NULL,
  algorithm          INT          NOT NULL,
  sign_count         BIGINT       NOT NULL DEFAULT 0,
  transports         VARCHAR(255),
  aaguid             CHAR(36),
  attestation_format VARCHAR(32)  NOT NULL DEFAULT 'none',
  backup_eligible    BOOLEAN      NOT NULL DEFAULT FALSE,
  backup_state       BOOLEAN      NOT NULL DEFAULT FALSE,
  name               VARCHAR(100) NOT NULL,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at       DATETIME(3),
  UNIQUE KEY uq_webauthn_credentials_hash (credential_hash),
  KEY idx_webauthn_credentials_user (user_id, site_id),
  CONSTRAINT fk_webauthn_credentials_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_webauthn_credentials_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Outstanding registration and sign-in challenges. Each row is claimed by
-- deleting it, so a challenge is accepted once, on whichever worker sees it
-- first. user_id is NULL for a passwordless sign-in, where the account is only
-- known once the authenticator answers.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id          CHAR(64)     NOT NULL PRIMARY KEY,
  site_id     CHAR(36)     NOT NULL,
  user_id     CHAR(36),
  purpose     VARCHAR(16)  NOT NULL,
  challenge   VARCHAR(128) NOT NULL,
  rp_id       VARCHAR(253) NOT NULL,
  origin      VARCHAR(300) NOT NULL,
  expires_at  DATETIME(3)  NOT NULL,
  KEY idx_webauthn_challenges_expires (expires_at),
  CONSTRAINT fk_webauthn_challenges_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_webauthn_challenges_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
