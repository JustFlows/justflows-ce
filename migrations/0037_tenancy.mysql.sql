-- Tenancy: workspaces, host routing, and database placement.
-- MySQL 8+ and MariaDB 10.6+ share this file.

CREATE TABLE IF NOT EXISTS tenants (
  id            CHAR(36) NOT NULL PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  slug          VARCHAR(60) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'active',
  user_mode     VARCHAR(20) NOT NULL DEFAULT 'isolated',
  database_mode VARCHAR(20) NOT NULL DEFAULT 'current',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenants_slug (slug),
  CONSTRAINT tenants_status_check CHECK (status IN ('active', 'suspended', 'provisioning', 'deleted')),
  CONSTRAINT tenants_user_mode_check CHECK (user_mode IN ('isolated', 'shared')),
  CONSTRAINT tenants_database_mode_check CHECK (database_mode IN ('current', 'separate'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key VARCHAR(191) NOT NULL PRIMARY KEY,
  value       JSON NOT NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO platform_settings (setting_key, value)
VALUES ('saas', '{"signupEnabled":false,"signupDatabaseMode":"current","baseDomain":""}');

CREATE TABLE IF NOT EXISTS platform_operators (
  user_id    CHAR(36) NOT NULL PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_platform_operators_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_audit (
  id         CHAR(36) NOT NULL PRIMARY KEY,
  actor_id   CHAR(36) NULL,
  action     VARCHAR(120) NOT NULL,
  target     VARCHAR(255) NULL,
  detail     TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_platform_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE sites ADD COLUMN tenant_id CHAR(36) NULL;
ALTER TABLE sites ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE sites ADD COLUMN database_choice VARCHAR(20) NOT NULL DEFAULT 'inherit';

INSERT INTO tenants (id, name, slug, status, user_mode, database_mode)
SELECT UUID(), 'Primary', 'primary', 'active', 'isolated', 'current'
FROM DUAL
WHERE EXISTS (SELECT 1 FROM sites)
  AND NOT EXISTS (SELECT 1 FROM (SELECT id FROM tenants WHERE slug = 'primary') AS existing);

UPDATE sites
SET tenant_id = (SELECT id FROM tenants WHERE slug = 'primary' LIMIT 1)
WHERE tenant_id IS NULL
  AND EXISTS (SELECT 1 FROM tenants WHERE slug = 'primary');

ALTER TABLE sites MODIFY tenant_id CHAR(36) NOT NULL;
ALTER TABLE sites ADD CONSTRAINT fk_sites_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE sites ADD INDEX idx_sites_tenant_id (tenant_id);

CREATE TABLE IF NOT EXISTS site_domains (
  id         CHAR(36) NOT NULL PRIMARY KEY,
  site_id    CHAR(36) NOT NULL,
  hostname   VARCHAR(253) NOT NULL,
  kind       VARCHAR(20) NOT NULL DEFAULT 'custom',
  verified   TINYINT(1) NOT NULL DEFAULT 0,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_site_domains_hostname (hostname),
  KEY idx_site_domains_site (site_id),
  CONSTRAINT fk_site_domains_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT site_domains_kind_check CHECK (kind IN ('primary', 'subdomain', 'custom'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO site_domains (id, site_id, hostname, kind, verified, is_primary)
SELECT UUID(),
       s.id,
       LOWER(SUBSTRING_INDEX(SUBSTRING_INDEX(REPLACE(REPLACE(s.url, 'https://', ''), 'http://', ''), '/', 1), ':', 1)),
       'primary',
       1,
       1
FROM sites s
WHERE CHAR_LENGTH(LOWER(SUBSTRING_INDEX(SUBSTRING_INDEX(REPLACE(REPLACE(s.url, 'https://', ''), 'http://', ''), '/', 1), ':', 1))) > 0;

CREATE TABLE IF NOT EXISTS tenant_databases (
  id                  CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id           CHAR(36) NOT NULL,
  site_id             CHAR(36) NULL,
  mode                VARCHAR(20) NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'ready',
  driver              VARCHAR(20) NULL,
  host                VARCHAR(255) NULL,
  port                INT NULL,
  database_name       VARCHAR(255) NULL,
  username            VARCHAR(255) NULL,
  password_ciphertext TEXT NULL,
  last_error          TEXT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tenant_databases_tenant (tenant_id),
  CONSTRAINT fk_tenant_databases_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_tenant_databases_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT tenant_databases_mode_check CHECK (mode IN ('current', 'separate')),
  CONSTRAINT tenant_databases_status_check CHECK (status IN ('pending', 'ready', 'failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tenant_databases (id, tenant_id, site_id, mode, status)
SELECT UUID(), t.id, NULL, 'current', 'ready'
FROM tenants t
WHERE t.id NOT IN (
  SELECT tenant_id FROM (
    SELECT tenant_id FROM tenant_databases WHERE site_id IS NULL
  ) AS existing
);

CREATE TABLE IF NOT EXISTS site_memberships (
  id         CHAR(36) NOT NULL PRIMARY KEY,
  user_id    CHAR(36) NOT NULL,
  site_id    CHAR(36) NOT NULL,
  role       VARCHAR(60) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_site_memberships (user_id, site_id),
  CONSTRAINT fk_site_memberships_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_site_memberships_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO platform_operators (user_id)
SELECT u.id
FROM users u
WHERE u.role = 'administrator'
  AND (SELECT COUNT(*) FROM (SELECT 1 FROM platform_operators) AS existing) = 0
ORDER BY u.created_at ASC
LIMIT 1;
