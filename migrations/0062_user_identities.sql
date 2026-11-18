/**
 * Accounts linked to an external identity provider (justflows-ce#54). A row
 * ties one provider subject, the provider's stable id for a person, to one
 * Justflows account. Sign-in through the provider finds the account by this
 * row; email is only used to link an existing account the first time.
 */
CREATE TABLE IF NOT EXISTS user_identities (
  id UUID PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id VARCHAR(64) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  email VARCHAR(320),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  UNIQUE (site_id, provider_id, subject)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(user_id);
