-- Justflows initial schema
-- Migration: 0001_initial

BEGIN;

-- ─── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM (
  'administrator',
  'editor',
  'author',
  'contributor',
  'subscriber'
);

CREATE TYPE content_status AS ENUM (
  'draft',
  'published',
  'unpublished',
  'trashed'
);

CREATE TYPE plugin_status AS ENUM (
  'installed',
  'active',
  'inactive',
  'error'
);

CREATE TYPE theme_status AS ENUM (
  'installed',
  'active',
  'inactive',
  'error'
);

-- ─── Sites ───────────────────────────────────────────────────────────────────

CREATE TABLE sites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(255)  NOT NULL,
  url          VARCHAR(2048) NOT NULL UNIQUE,
  description  TEXT,
  active       BOOLEAN       NOT NULL DEFAULT TRUE,
  installed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Users ───────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  email         VARCHAR(320) NOT NULL,
  username      VARCHAR(60)  NOT NULL,
  display_name  VARCHAR(255) NOT NULL,
  password_hash TEXT         NOT NULL,
  role          user_role    NOT NULL DEFAULT 'subscriber',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, email),
  UNIQUE (site_id, username)
);

CREATE INDEX idx_users_site_id ON users(site_id);
CREATE INDEX idx_users_email ON users(email);

-- ─── Content ─────────────────────────────────────────────────────────────────

CREATE TABLE content (
  id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID           NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  type         VARCHAR(60)    NOT NULL DEFAULT 'post',
  title        VARCHAR(1024)  NOT NULL,
  slug         VARCHAR(1024)  NOT NULL,
  excerpt      TEXT,
  blocks       JSONB          NOT NULL DEFAULT '[]',
  fields       JSONB          NOT NULL DEFAULT '{}',
  status       content_status NOT NULL DEFAULT 'draft',
  author_id    UUID           REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, type, slug)
);

CREATE INDEX idx_content_site_id ON content(site_id);
CREATE INDEX idx_content_status ON content(status);
CREATE INDEX idx_content_type ON content(type);
CREATE INDEX idx_content_published_at ON content(published_at);

-- ─── Site Settings ───────────────────────────────────────────────────────────

CREATE TABLE site_settings (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  key        VARCHAR(255) NOT NULL,
  value      JSONB,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, key)
);

CREATE INDEX idx_site_settings_site_id ON site_settings(site_id);

-- ─── Plugins ─────────────────────────────────────────────────────────────────

CREATE TABLE plugins (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id             UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  plugin_id           VARCHAR(255)  NOT NULL,
  version             VARCHAR(50)   NOT NULL,
  status              plugin_status NOT NULL DEFAULT 'installed',
  manifest            JSONB         NOT NULL,
  approved_permissions JSONB        NOT NULL DEFAULT '[]',
  safe_mode           BOOLEAN       NOT NULL DEFAULT FALSE,
  installed_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  activated_at        TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, plugin_id)
);

CREATE INDEX idx_plugins_site_id ON plugins(site_id);
CREATE INDEX idx_plugins_status ON plugins(status);

CREATE TABLE themes (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  theme_id      VARCHAR(255)  NOT NULL,
  name          VARCHAR(255)  NOT NULL,
  version       VARCHAR(50)   NOT NULL,
  publisher     VARCHAR(255)  NOT NULL DEFAULT '',
  description   TEXT,
  status        theme_status  NOT NULL DEFAULT 'installed',
  css_variables JSONB         NOT NULL DEFAULT '{}',
  manifest      JSONB         NOT NULL DEFAULT '{}',
  installed_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  activated_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, theme_id)
);

CREATE INDEX idx_themes_site_id ON themes(site_id);
CREATE INDEX idx_themes_status ON themes(status);

CREATE TABLE media (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  filename     VARCHAR(512) NOT NULL,
  mime_type    VARCHAR(128) NOT NULL,
  size_bytes   BIGINT       NOT NULL,
  storage_key  TEXT         NOT NULL,
  url          TEXT         NOT NULL,
  alt_text     TEXT,
  caption      TEXT,
  width        INT,
  height       INT,
  derivatives  JSONB        NOT NULL DEFAULT '{}',
  uploaded_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE revisions (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id   UUID          NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  site_id      UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  title        VARCHAR(1024) NOT NULL,
  blocks       JSONB         NOT NULL DEFAULT '[]',
  fields       JSONB         NOT NULL DEFAULT '{}',
  version      INT           NOT NULL DEFAULT 1,
  created_by   UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE taxonomies (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug         VARCHAR(255)  NOT NULL,
  name         VARCHAR(255)  NOT NULL,
  description  TEXT,
  hierarchical BOOLEAN       NOT NULL DEFAULT FALSE,
  UNIQUE (site_id, slug)
);

CREATE TABLE terms (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  taxonomy_id  UUID          NOT NULL REFERENCES taxonomies(id) ON DELETE CASCADE,
  slug         VARCHAR(255)  NOT NULL,
  name         VARCHAR(255)  NOT NULL,
  description  TEXT,
  parent_id    UUID          REFERENCES terms(id) ON DELETE SET NULL,
  UNIQUE (taxonomy_id, slug)
);

CREATE TABLE content_terms (
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  term_id    UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  PRIMARY KEY (content_id, term_id)
);

CREATE TABLE menus (
  id       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id  UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug     VARCHAR(255)  NOT NULL,
  name     VARCHAR(255)  NOT NULL,
  items    JSONB         NOT NULL DEFAULT '[]',
  UNIQUE (site_id, slug)
);

CREATE TABLE comments (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  content_id   UUID          NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  parent_id    UUID          REFERENCES comments(id) ON DELETE CASCADE,
  author_name  VARCHAR(255)  NOT NULL,
  author_email VARCHAR(320),
  author_url   TEXT,
  body         TEXT          NOT NULL,
  status       VARCHAR(20)   NOT NULL DEFAULT 'pending',
  user_id      UUID          REFERENCES users(id) ON DELETE SET NULL,
  ip_address   VARCHAR(64),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE jobs (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID          REFERENCES sites(id) ON DELETE CASCADE,
  name         VARCHAR(255)  NOT NULL,
  payload      JSONB         NOT NULL DEFAULT '{}',
  status       VARCHAR(20)   NOT NULL DEFAULT 'pending',
  attempts     INT           NOT NULL DEFAULT 0,
  max_attempts INT           NOT NULL DEFAULT 3,
  run_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at    TIMESTAMPTZ,
  error        TEXT,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_log (
  id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id    UUID          REFERENCES users(id) ON DELETE SET NULL,
  action     VARCHAR(255)  NOT NULL,
  target     VARCHAR(255),
  target_id  UUID,
  metadata   JSONB         NOT NULL DEFAULT '{}',
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_media_site_id ON media(site_id);
CREATE INDEX idx_media_uploaded_at ON media(uploaded_at);
CREATE INDEX idx_revisions_content_id ON revisions(content_id);
CREATE INDEX idx_comments_content_id ON comments(content_id);
CREATE INDEX idx_comments_status ON comments(status);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_run_at ON jobs(run_at);
CREATE INDEX idx_audit_log_site_id ON audit_log(site_id);
CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);

-- ─── Migrations tracker ──────────────────────────────────────────────────────

CREATE TABLE _migrations (
  id         SERIAL      PRIMARY KEY,
  name       VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO _migrations (name) VALUES ('0001_initial');

COMMIT;
