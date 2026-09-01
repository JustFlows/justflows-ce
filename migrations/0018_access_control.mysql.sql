-- 0018_access_control — MySQL and MariaDB (#22, #53)
CREATE TABLE IF NOT EXISTS access_roles (
  id VARCHAR(80) NOT NULL PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500),
  capabilities_json TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_access_roles_site_name (site_id, name),
  KEY idx_access_roles_site (site_id),
  CONSTRAINT fk_access_roles_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_access_policies (
  user_id CHAR(36) NOT NULL PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  role_id VARCHAR(80),
  grants_json TEXT NOT NULL,
  denies_json TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_access_site (site_id),
  CONSTRAINT fk_user_access_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_access_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_access_role FOREIGN KEY (role_id) REFERENCES access_roles(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
