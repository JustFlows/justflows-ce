-- 0026_api_keys
-- Revocable API keys for the headless federated management API (#135).
--
-- Each key authenticates `/api/manage/v1` requests as `Authorization: Bearer
-- jfk_<secret>`. Only the SHA-256 hash of the secret is stored; the plaintext
-- is shown once at creation. `key_prefix` is the visible, non-secret head of
-- the token so a key stays identifiable in lists and logs. `capabilities_json`
-- is the key's explicit capability set — never broader than its creator's at
-- creation time, and re-intersected with the owner's *current* access on every
-- request. `scopes_json` is an AccessScope-shaped restriction applied on top of
-- every capability. Revocation (`revoked_at`), expiry (`expires_at`) and the
-- global `manage_api_enabled` site setting all take effect per request, with no
-- process restart.

CREATE TABLE IF NOT EXISTS api_keys (
  id VARCHAR(36) PRIMARY KEY,
  site_id VARCHAR(36) NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  key_prefix VARCHAR(16) NOT NULL,
  key_hash VARCHAR(128) NOT NULL UNIQUE,
  owner_user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by VARCHAR(36) NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  scopes_json TEXT NOT NULL DEFAULT '{}',
  allowed_ips_json TEXT NOT NULL DEFAULT '[]',
  allowed_origins_json TEXT NOT NULL DEFAULT '[]',
  rate_limit_per_min INTEGER,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  last_used_ip VARCHAR(64),
  request_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_site ON api_keys (site_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys (owner_user_id);

-- Let a key own the webhook endpoints it self-registers, so an integration can
-- subscribe itself instead of an administrator wiring it by hand. NULL means
-- the endpoint was created from the admin UI and is not tied to a key.
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS api_key_id VARCHAR(36);
