-- 0035_user_additional_roles — MySQL and MariaDB. See the PostgreSQL file.
CREATE TABLE IF NOT EXISTS user_additional_roles (
  user_id    CHAR(36)    NOT NULL,
  site_id    CHAR(36)    NOT NULL,
  role       VARCHAR(32) NOT NULL,
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role),
  KEY idx_user_additional_roles_site_role (site_id, role),
  CONSTRAINT fk_user_additional_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_additional_roles_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
