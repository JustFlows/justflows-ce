-- Justflows CSS providers
-- Migration: 0003_css_providers

BEGIN;

CREATE TYPE css_provider_status AS ENUM (
  'installed',
  'active',
  'inactive',
  'error'
);

CREATE TABLE css_providers (
  id            UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID                 NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  provider_id   VARCHAR(255)         NOT NULL,
  name          VARCHAR(255)         NOT NULL,
  version       VARCHAR(50)          NOT NULL,
  publisher     VARCHAR(255)         NOT NULL DEFAULT '',
  description   TEXT,
  status        css_provider_status  NOT NULL DEFAULT 'installed',
  manifest      JSONB                NOT NULL DEFAULT '{}',
  installed_at  TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  activated_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, provider_id)
);

CREATE INDEX idx_css_providers_site_id ON css_providers(site_id);
CREATE INDEX idx_css_providers_status ON css_providers(status);

COMMIT;
