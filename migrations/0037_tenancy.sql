-- Tenancy: workspaces, host routing, and database placement.
-- Existing installs gain one Primary workspace on the current database.

CREATE TABLE IF NOT EXISTS tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  slug          VARCHAR(60) NOT NULL UNIQUE,
  status        VARCHAR(20) NOT NULL DEFAULT 'active',
  user_mode     VARCHAR(20) NOT NULL DEFAULT 'isolated',
  database_mode VARCHAR(20) NOT NULL DEFAULT 'current',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenants_status_check CHECK (status IN ('active', 'suspended', 'provisioning', 'deleted')),
  CONSTRAINT tenants_user_mode_check CHECK (user_mode IN ('isolated', 'shared')),
  CONSTRAINT tenants_database_mode_check CHECK (database_mode IN ('current', 'separate'))
);

CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key VARCHAR(191) PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_settings (setting_key, value, updated_at)
SELECT 'saas', '{"signupEnabled":false,"signupDatabaseMode":"current","baseDomain":""}'::jsonb, NOW()
WHERE NOT EXISTS (SELECT 1 FROM platform_settings WHERE setting_key = 'saas');

CREATE TABLE IF NOT EXISTS platform_operators (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_audit (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   UUID,
  action     VARCHAR(120) NOT NULL,
  target     VARCHAR(255),
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sites ADD COLUMN tenant_id UUID;
ALTER TABLE sites ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE sites ADD COLUMN database_choice VARCHAR(20) NOT NULL DEFAULT 'inherit';

INSERT INTO tenants (id, name, slug, status, user_mode, database_mode, created_at, updated_at)
SELECT gen_random_uuid(), 'Primary', 'primary', 'active', 'isolated', 'current', NOW(), NOW()
WHERE EXISTS (SELECT 1 FROM sites)
  AND NOT EXISTS (SELECT 1 FROM tenants);

UPDATE sites
SET tenant_id = (SELECT id FROM tenants WHERE slug = 'primary' LIMIT 1)
WHERE tenant_id IS NULL
  AND EXISTS (SELECT 1 FROM tenants WHERE slug = 'primary');

ALTER TABLE sites ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE sites ADD CONSTRAINT fk_sites_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_sites_tenant_id ON sites(tenant_id);

CREATE TABLE IF NOT EXISTS site_domains (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  hostname   VARCHAR(253) NOT NULL UNIQUE,
  kind       VARCHAR(20) NOT NULL DEFAULT 'custom',
  verified   BOOLEAN NOT NULL DEFAULT FALSE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT site_domains_kind_check CHECK (kind IN ('primary', 'subdomain', 'custom'))
);

INSERT INTO site_domains (id, site_id, hostname, kind, verified, is_primary, created_at)
SELECT gen_random_uuid(),
       s.id,
       lower(split_part(split_part(regexp_replace(s.url, '^https?://', ''), '/', 1), ':', 1)),
       'primary',
       TRUE,
       TRUE,
       NOW()
FROM sites s
WHERE length(split_part(split_part(regexp_replace(s.url, '^https?://', ''), '/', 1), ':', 1)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM site_domains d
    WHERE d.hostname = lower(split_part(split_part(regexp_replace(s.url, '^https?://', ''), '/', 1), ':', 1))
  );

CREATE TABLE IF NOT EXISTS tenant_databases (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id              UUID REFERENCES sites(id) ON DELETE CASCADE,
  mode                 VARCHAR(20) NOT NULL,
  status               VARCHAR(20) NOT NULL DEFAULT 'ready',
  driver               VARCHAR(20),
  host                 VARCHAR(255),
  port                 INTEGER,
  database_name        VARCHAR(255),
  username             VARCHAR(255),
  password_ciphertext  TEXT,
  last_error           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenant_databases_mode_check CHECK (mode IN ('current', 'separate')),
  CONSTRAINT tenant_databases_status_check CHECK (status IN ('pending', 'ready', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_databases_tenant ON tenant_databases(tenant_id);

INSERT INTO tenant_databases (id, tenant_id, site_id, mode, status, created_at, updated_at)
SELECT gen_random_uuid(), t.id, NULL, 'current', 'ready', NOW(), NOW()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_databases d WHERE d.tenant_id = t.id AND d.site_id IS NULL
);

CREATE TABLE IF NOT EXISTS site_memberships (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id    UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  role       VARCHAR(60) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, site_id)
);

INSERT INTO platform_operators (user_id, created_at)
SELECT u.id, NOW()
FROM users u
WHERE u.role = 'administrator'
  AND NOT EXISTS (SELECT 1 FROM platform_operators)
ORDER BY u.created_at ASC
LIMIT 1;
