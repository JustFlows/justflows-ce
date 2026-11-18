/**
 * Accounts linked to an external identity provider (justflows-ce#54). A row
 * ties one provider subject, the provider's stable id for a person, to one
 * Justflows account. Sign-in through the provider finds the account by this
 * row; email is only used to link an existing account the first time.
 */
CREATE TABLE IF NOT EXISTS user_identities (
  id CHAR(36) PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  provider_id VARCHAR(64) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  email VARCHAR(320),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at DATETIME(3),
  CONSTRAINT fk_user_identities_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_identities_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_user_identities_subject (site_id, provider_id, subject),
  INDEX idx_user_identities_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
