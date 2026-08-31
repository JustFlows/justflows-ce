
-- -----------------------------------------------------------------------------
-- Consolidated migration: 0001_initial
-- -----------------------------------------------------------------------------

-- Justflows initial schema

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


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0002_multilingual
-- -----------------------------------------------------------------------------

-- Justflows multilingual support

BEGIN;

CREATE TABLE IF NOT EXISTS languages (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  code         VARCHAR(20)  NOT NULL,
  name         VARCHAR(100) NOT NULL,
  native_name  VARCHAR(100) NOT NULL,
  is_default   BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order   INT          NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, code)
);

CREATE INDEX IF NOT EXISTS idx_languages_site_id ON languages(site_id);

ALTER TABLE content ADD COLUMN IF NOT EXISTS locale VARCHAR(20) NOT NULL DEFAULT 'en';
ALTER TABLE content ADD COLUMN IF NOT EXISTS translation_group_id UUID;

-- Replace slug uniqueness to be per-locale
ALTER TABLE content DROP CONSTRAINT IF EXISTS content_site_id_type_slug_key;
ALTER TABLE content DROP CONSTRAINT IF EXISTS content_site_id_type_slug_locale_key;
ALTER TABLE content ADD CONSTRAINT content_site_id_type_slug_locale_key UNIQUE (site_id, type, slug, locale);

CREATE INDEX IF NOT EXISTS idx_content_locale ON content(locale);
CREATE INDEX IF NOT EXISTS idx_content_translation_group ON content(translation_group_id);

COMMIT;


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0003_css_providers
-- -----------------------------------------------------------------------------

-- Justflows CSS providers

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


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0004_plugin_data
-- -----------------------------------------------------------------------------

-- Justflows plugin-scoped JSON documents

BEGIN;

CREATE TABLE plugin_data (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  plugin_id   VARCHAR(255) NOT NULL,
  collection  VARCHAR(100) NOT NULL,
  item_id     VARCHAR(255) NOT NULL,
  payload     JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, plugin_id, collection, item_id)
);

CREATE INDEX idx_plugin_data_lookup ON plugin_data (site_id, plugin_id, collection);

COMMIT;


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0005_content_types
-- -----------------------------------------------------------------------------

-- Justflows persisted content type definitions

BEGIN;

CREATE TABLE IF NOT EXISTS content_types (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug         VARCHAR(60)  NOT NULL,
  label        VARCHAR(255) NOT NULL,
  description  TEXT         NOT NULL DEFAULT '',
  is_builtin   BOOLEAN      NOT NULL DEFAULT FALSE,
  fields       JSONB        NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_content_types_site_id ON content_types(site_id);

COMMIT;


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0006_session_revocation
-- -----------------------------------------------------------------------------

-- Justflows session revocation counter
--
-- Session tokens are stateless HMACs, so logging out only clears the cookie and
-- a captured token stays valid for its full lifetime. This counter is embedded
-- in the token and compared on every request, which is what lets a password
-- change or an explicit "sign out everywhere" take effect immediately.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

COMMIT;


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0007_totp
-- -----------------------------------------------------------------------------

-- Justflows two-factor authentication (TOTP)
--
-- An administrator who can upload a .jfpkg or a core .zip can run code on the
-- server, so a single password is the only thing in front of shell access.
-- Rate limiting slows online guessing but does nothing against a reused
-- password from a breach corpus, or a phishing page.
--
-- The secret is stored encrypted (secret-box, AES-256-GCM under a key derived
-- from APP_SECRET), so a database backup does not hand over working seeds.
-- totp_confirmed_at stays NULL until the user proves they can generate a code,
-- which is what stops an interrupted enrolment from locking someone out.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_confirmed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery_codes TEXT;

COMMIT;


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0008_audit_log
-- -----------------------------------------------------------------------------

-- Justflows administrative audit log
--
-- There was no record of who signed in, who changed a role, who uploaded a
-- package or who altered the security-header policy. For an administrator role
-- the project documents as equivalent to shell access, that means a compromise
-- cannot be reconstructed afterwards — which is the point at which anyone asks.
--
-- Append-only by convention: nothing in the application updates or deletes a
-- row except the retention sweep, which drops entries past their age limit.
--
-- actor_id is intentionally NOT a foreign key. Deleting a user must not delete
-- the record of what that user did, and ON DELETE SET NULL would erase the one
-- detail the entry exists to carry.

BEGIN;

CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  action      VARCHAR(64)  NOT NULL,
  outcome     VARCHAR(16)  NOT NULL DEFAULT 'success',
  actor_id    UUID,
  actor_email VARCHAR(320),
  actor_role  VARCHAR(32),
  target      VARCHAR(255),
  ip          VARCHAR(64),
  user_agent  VARCHAR(255),
  detail      TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_site_time ON audit_log(site_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(site_id, action);

COMMIT;


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0009_audit_log_compat
-- -----------------------------------------------------------------------------

-- Repair audit_log installations upgraded from the legacy 0001 schema.
-- 0008 used CREATE TABLE IF NOT EXISTS, so it could not add its newer columns
-- when the old table was already present. Keep the legacy columns and data;
-- runtime writes explicitly populate the legacy metadata column as well.

BEGIN;

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS outcome VARCHAR(16) NOT NULL DEFAULT 'success';
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_id UUID;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_email VARCHAR(320);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_role VARCHAR(32);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip VARCHAR(64);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_agent VARCHAR(255);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS detail TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

UPDATE audit_log
SET occurred_at = COALESCE(occurred_at, created_at, NOW()),
    actor_id = COALESCE(actor_id, user_id),
    ip = COALESCE(ip, ip_address)
WHERE occurred_at IS NULL OR actor_id IS NULL OR ip IS NULL;
ALTER TABLE audit_log ALTER COLUMN occurred_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_site_time ON audit_log(site_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(site_id, action);

COMMIT;


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0010_content_revisions
-- -----------------------------------------------------------------------------

-- Justflows working content revisions
--
-- Published content keeps its row as the live snapshot. Saves write a single
-- working revision until an explicit publish copies it onto the live row.

BEGIN;

ALTER TABLE content ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

ALTER TABLE revisions ADD COLUMN IF NOT EXISTS slug VARCHAR(1024) NOT NULL DEFAULT '';
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS excerpt TEXT;
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS locale VARCHAR(20);
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS translation_group_id UUID;
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'historical';
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual';
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS base_version INT NOT NULL DEFAULT 1;
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_revisions_working
  ON revisions (content_id) WHERE kind = 'working';
CREATE UNIQUE INDEX IF NOT EXISTS uq_revisions_autosave
  ON revisions (content_id) WHERE kind = 'autosave';
CREATE INDEX IF NOT EXISTS idx_revisions_kind_created
  ON revisions (content_id, kind, created_at DESC);

COMMIT;


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0011_default_locale_en_us
-- -----------------------------------------------------------------------------

-- Remap the seeded language-only English tag to en-US.

BEGIN;

UPDATE content c
SET locale = 'en-US'
WHERE c.locale = 'en'
  AND NOT EXISTS (
    SELECT 1 FROM content o
    WHERE o.site_id = c.site_id
      AND o.type = c.type
      AND o.slug = c.slug
      AND o.locale = 'en-US'
  );

UPDATE revisions SET locale = 'en-US' WHERE locale = 'en';

UPDATE languages l
SET code = 'en-US'
WHERE l.code = 'en'
  AND NOT EXISTS (
    SELECT 1 FROM languages x
    WHERE x.site_id = l.site_id AND x.code = 'en-US'
  );

DELETE FROM languages l
WHERE l.code = 'en'
  AND EXISTS (
    SELECT 1 FROM languages x
    WHERE x.site_id = l.site_id AND x.code = 'en-US'
  )
  AND NOT EXISTS (
    SELECT 1 FROM content c
    WHERE c.site_id = l.site_id AND c.locale = 'en'
  );

ALTER TABLE content ALTER COLUMN locale SET DEFAULT 'en-US';

COMMIT;


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0012_template_parts
-- -----------------------------------------------------------------------------

-- Justflows template parts
--
-- Site-wide chrome edited as a document (header library, footer blocks) is a
-- design artifact, not a preference — it gets its own table instead of living
-- as JSON rows in site_settings. One row per (site, part); `doc` is the
-- published document, `draft_doc` the unpublished working copy (NULL when none).
-- Existing site_settings rows (template_part.*, template_part_draft.*) are
-- copied over and removed by a one-time application backfill on boot.

BEGIN;

CREATE TABLE IF NOT EXISTS template_parts (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    UUID        NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  part       VARCHAR(40) NOT NULL,
  doc        JSONB       NOT NULL DEFAULT '{}',
  draft_doc  JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, part)
);

CREATE INDEX IF NOT EXISTS idx_template_parts_site ON template_parts(site_id);

COMMIT;

