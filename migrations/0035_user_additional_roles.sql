-- 0035_user_additional_roles — roles a user holds next to users.role.
-- users.role stays the primary role: requireRole() and the last-administrator
-- guard read only that. Additional roles add their capabilities, so a
-- subscriber can also be a shop customer. Administrator is never stored here.
CREATE TABLE IF NOT EXISTS user_additional_roles (
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id    UUID        NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  role       VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role)
);
CREATE INDEX IF NOT EXISTS idx_user_additional_roles_site_role ON user_additional_roles(site_id, role);
