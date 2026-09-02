-- 0016_user_preferences
-- Per-user administration preferences — the dashboard welcome/discovery panel
-- state today, and future personal toggles. One JSON row per (user, key),
-- mirroring the shape of site_settings but scoped to a user instead of a site.
-- `key` is namespaced by the caller; the route layer allowlists which keys may
-- be written so the table cannot grow unbounded from arbitrary input.

CREATE TABLE IF NOT EXISTS user_preferences (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key        VARCHAR(255) NOT NULL,
  value      JSONB,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id);
