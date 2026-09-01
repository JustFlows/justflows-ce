-- 0018_access_control — custom roles and per-user access policies (#22, #53)
CREATE TABLE IF NOT EXISTS access_roles (
  id VARCHAR(80) PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500),
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(site_id, name)
);
CREATE INDEX IF NOT EXISTS idx_access_roles_site ON access_roles(site_id);

CREATE TABLE IF NOT EXISTS user_access_policies (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  role_id VARCHAR(80),
  grants_json TEXT NOT NULL DEFAULT '[]',
  denies_json TEXT NOT NULL DEFAULT '[]',
  scopes_json TEXT NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (role_id) REFERENCES access_roles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_user_access_site ON user_access_policies(site_id);
