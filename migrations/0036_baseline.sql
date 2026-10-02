
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

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0013_public_comments
-- -----------------------------------------------------------------------------

-- 0013_public_comments
--
-- Public comment submission, moderation notifications, and threaded rendering.
-- The comments table already carries author/body/status/parent_id from the
-- baseline; this migration only adds opt-in reply notifications, a one-click
-- unsubscribe token, a moderator-edit marker, and the indexes the public
-- thread query and reply lookups need.

ALTER TABLE comments ADD COLUMN IF NOT EXISTS notify BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS unsubscribe_token VARCHAR(64);
ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_comments_thread
  ON comments (site_id, content_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent
  ON comments (parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_unsubscribe
  ON comments (unsubscribe_token);

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0014_content_webhooks
-- -----------------------------------------------------------------------------

-- 0014_content_webhooks
-- Persist webhook endpoints and every delivery attempt. Signing secrets are
-- encrypted by the application before they reach webhook_endpoints.

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id VARCHAR(36) PRIMARY KEY,
  site_id VARCHAR(36) NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  events TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_site
  ON webhook_endpoints (site_id, active);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id VARCHAR(36) PRIMARY KEY,
  endpoint_id VARCHAR(36) NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  site_id VARCHAR(36) NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event VARCHAR(160) NOT NULL,
  payload TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  response_body VARCHAR(2048),
  error VARCHAR(1024),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
  ON webhook_deliveries (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint
  ON webhook_deliveries (endpoint_id, created_at);

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0015_theme_designs
-- -----------------------------------------------------------------------------

-- 0015_theme_designs
-- Per-theme customization documents (Customizer mods, homepage design, blog
-- design) are design artifacts, not site preferences — they get their own table
-- instead of living as JSON rows in site_settings (theme_mods.*, theme_home.*,
-- theme_blog.* and their *_draft.* siblings). One row per (site, theme, kind):
-- `doc` is the published document, `draft_doc` the unpublished working copy
-- (NULL when none). The old site_settings rows are copied over and removed by a
-- one-time application backfill on boot (see theme-designs-migrate.ts).

CREATE TABLE IF NOT EXISTS theme_designs (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  theme_id   VARCHAR(255) NOT NULL,
  kind       VARCHAR(40)  NOT NULL,
  doc        JSONB        NOT NULL DEFAULT '{}',
  draft_doc  JSONB,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, theme_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_theme_designs_site ON theme_designs(site_id, theme_id);

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0016_user_preferences
-- -----------------------------------------------------------------------------

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

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0017_password_resets
-- -----------------------------------------------------------------------------

-- 0017_password_resets
-- Self-service password recovery for administrators and users (#93).
--
-- One row per outstanding "forgot password" request. The link mailed to the
-- account carries a high-entropy token; only its SHA-256 hash is stored here, so
-- a database backup, a read-only injection or a support export never yields a
-- usable reset link. A row is single-use (used_at is stamped on redemption),
-- time-limited (expires_at), and bound to one account. Every row for a user is
-- deleted on a successful reset, on any password change, and on demand once
-- expired, so the table stays small and a captured-but-unused link cannot be
-- combined with a later one.

CREATE TABLE IF NOT EXISTS password_resets (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id      UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  -- SHA-256 hex digest of the single-use token. Never the token itself.
  token_hash   CHAR(64)     NOT NULL UNIQUE,
  -- Coarse origin of the request, for the audit trail and abuse triage only.
  requested_ip VARCHAR(64),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ  NOT NULL,
  used_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON password_resets(expires_at);

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0018_access_control
-- -----------------------------------------------------------------------------

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

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0019_device_sessions
-- -----------------------------------------------------------------------------

-- 0019_device_sessions — individually revocable login sessions (#54)
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_agent VARCHAR(255),
  ip VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, site_id);

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0020_email_delivery
-- -----------------------------------------------------------------------------

-- 0020_email_delivery — outbound email operations (#104)
CREATE TABLE IF NOT EXISTS email_deliveries (
  id UUID PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  message_type VARCHAR(80) NOT NULL,
  recipient_masked VARCHAR(320) NOT NULL,
  recipient_hash VARCHAR(64) NOT NULL,
  recipient_encrypted TEXT NOT NULL,
  message_encrypted TEXT NOT NULL,
  subject VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL,
  transport VARCHAR(120) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_response TEXT,
  error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_site_created ON email_deliveries(site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_retry ON email_deliveries(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS email_suppressions (
  id UUID PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  email_hash VARCHAR(64) NOT NULL,
  email_masked VARCHAR(320) NOT NULL,
  message_type VARCHAR(80) NOT NULL,
  reason VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(site_id, email_hash, message_type)
);

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0021_trash_retention
-- -----------------------------------------------------------------------------

-- Recoverable deletion for site-owned content.
ALTER TABLE content ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ;
ALTER TABLE content ADD COLUMN IF NOT EXISTS trashed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE content ADD COLUMN IF NOT EXISTS original_slug VARCHAR(1024);
ALTER TABLE content ADD COLUMN IF NOT EXISTS original_status content_status;

ALTER TABLE media ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ;
ALTER TABLE media ADD COLUMN IF NOT EXISTS trashed_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE comments ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS trashed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS original_status VARCHAR(20);

ALTER TABLE menus ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ;
ALTER TABLE menus ADD COLUMN IF NOT EXISTS trashed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE menus ADD COLUMN IF NOT EXISTS original_slug VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_content_trash ON content(site_id, trashed_at);
CREATE INDEX IF NOT EXISTS idx_media_trash ON media(site_id, trashed_at);
CREATE INDEX IF NOT EXISTS idx_comments_trash ON comments(site_id, trashed_at);
CREATE INDEX IF NOT EXISTS idx_menus_trash ON menus(site_id, trashed_at);

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0022_email_templates
-- -----------------------------------------------------------------------------

-- 0022_email_templates — versioned system email design and templates (#63)
CREATE TABLE IF NOT EXISTS email_design_versions (
  id UUID PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL,
  design TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  UNIQUE(site_id, version)
);
CREATE INDEX IF NOT EXISTS idx_email_design_site_status ON email_design_versions(site_id, status);

CREATE TABLE IF NOT EXISTS email_template_versions (
  id UUID PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  template_key VARCHAR(160) NOT NULL,
  owner VARCHAR(160) NOT NULL,
  locale VARCHAR(20) NOT NULL,
  version INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sender_name VARCHAR(120),
  reply_to_policy VARCHAR(20) NOT NULL DEFAULT 'global',
  subject VARCHAR(500) NOT NULL,
  preheader VARCHAR(500) NOT NULL DEFAULT '',
  html_content TEXT NOT NULL,
  text_content TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  UNIQUE(site_id, template_key, locale, version)
);
CREATE INDEX IF NOT EXISTS idx_email_template_lookup ON email_template_versions(site_id, template_key, locale, status);

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0023_templates
-- -----------------------------------------------------------------------------

-- 0023_templates
-- Per-site overrides of a theme's template-hierarchy files (Theme builder →
-- Templates). When an editor customises `templates/<slug>.json` the edited
-- block document lives here rather than in the theme package, so it survives
-- theme updates and can be reset. One row per (site, theme, slug): `doc` is the
-- published document, `draft_doc` the unpublished working copy (NULL when
-- none). No row means "use the theme's own templates/<slug>.json", and failing
-- that the built-in view.

CREATE TABLE IF NOT EXISTS theme_templates (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  theme_id   VARCHAR(255) NOT NULL,
  slug       VARCHAR(120) NOT NULL,
  doc        JSONB        NOT NULL DEFAULT '{}',
  draft_doc  JSONB,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, theme_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_theme_templates_site ON theme_templates(site_id, theme_id);

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0024_menu_designer
-- -----------------------------------------------------------------------------

-- 0024_menu_designer
-- Adds the menu designer's layout/design contract and a draft/publish split to
-- `menus`, mirroring the `theme_templates`/`theme_designs` draft_doc pattern:
-- `design` holds the published layout/design config (layout kind, activation,
-- breakpoint, columns, theme-token overrides, ...), `draft_items`/
-- `draft_design` hold an unpublished working copy the admin preview iframe
-- reads, and `schema_version` lets menu-item resolution evolve without
-- breaking rows written by an older core version. A NULL/empty `design`
-- means "use the built-in defaults" (parsed leniently, like `items` already
-- is), so every existing menu keeps rendering exactly as before.

ALTER TABLE menus ADD COLUMN IF NOT EXISTS design JSONB;
ALTER TABLE menus ADD COLUMN IF NOT EXISTS draft_items JSONB;
ALTER TABLE menus ADD COLUMN IF NOT EXISTS draft_design JSONB;
ALTER TABLE menus ADD COLUMN IF NOT EXISTS schema_version INT NOT NULL DEFAULT 1;

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0025_redirect_manager
-- -----------------------------------------------------------------------------

-- Redirect manager and bounded, aggregate public 404 reporting (#100).
CREATE TABLE IF NOT EXISTS redirects (
  id UUID PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  rule TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redirects_site ON redirects(site_id);
CREATE TABLE IF NOT EXISTS redirect_not_found (
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  path_hash VARCHAR(64) NOT NULL,
  path VARCHAR(2048) NOT NULL,
  hits BIGINT NOT NULL DEFAULT 1,
  referrer VARCHAR(512) NOT NULL DEFAULT '',
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (site_id, path_hash)
);
CREATE INDEX IF NOT EXISTS idx_redirect_not_found_seen ON redirect_not_found(site_id, last_seen);

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0026_api_keys
-- -----------------------------------------------------------------------------

-- 0026_api_keys
-- Revocable API keys for the headless federated management API (#135).
--
-- Each key authenticates `/api/manage/v1` requests as `Authorization: Bearer
-- jfk_<secret>`. Only the SHA-256 hash of the secret is stored; the plaintext
-- is shown once at creation. `key_prefix` is the visible, non-secret head of
-- the token so a key stays identifiable in lists and logs. `capabilities_json`
-- is the key's explicit capability set — never broader than its creator's at
-- creation time, and re-intersected with the owner's *current* access on every
-- request. `scopes_json` is an AccessScope-shaped restriction applied on top of
-- every capability. Revocation (`revoked_at`), expiry (`expires_at`) and the
-- global `manage_api_enabled` site setting all take effect per request, with no
-- process restart.

CREATE TABLE IF NOT EXISTS api_keys (
  id VARCHAR(36) PRIMARY KEY,
  site_id VARCHAR(36) NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  key_prefix VARCHAR(16) NOT NULL,
  key_hash VARCHAR(128) NOT NULL UNIQUE,
  owner_user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by VARCHAR(36) NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  scopes_json TEXT NOT NULL DEFAULT '{}',
  allowed_ips_json TEXT NOT NULL DEFAULT '[]',
  allowed_origins_json TEXT NOT NULL DEFAULT '[]',
  rate_limit_per_min INTEGER,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  last_used_ip VARCHAR(64),
  request_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_site ON api_keys (site_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys (owner_user_id);

-- Let a key own the webhook endpoints it self-registers, so an integration can
-- subscribe itself instead of an administrator wiring it by hand. NULL means
-- the endpoint was created from the admin UI and is not tied to a key.
ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS api_key_id VARCHAR(36);

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0027_media_responsive
-- -----------------------------------------------------------------------------

-- 0027_media_responsive
-- Responsive image derivatives, focal point, and source format for the media
-- library (#103). The `derivatives` column (JSONB, shipped in 0012_baseline)
-- now carries the generated variant set: width-scaled WebP/AVIF plus a fallback
-- format, and a focal-point thumbnail. These columns add the art-direction
-- focal point (0..1 on each axis), the detected source format, and the time the
-- variant set was last (re)built by the Tools regeneration job.
ALTER TABLE media ADD COLUMN IF NOT EXISTS focal_x DOUBLE PRECISION;
ALTER TABLE media ADD COLUMN IF NOT EXISTS focal_y DOUBLE PRECISION;
ALTER TABLE media ADD COLUMN IF NOT EXISTS original_format VARCHAR(16);
ALTER TABLE media ADD COLUMN IF NOT EXISTS variants_generated_at TIMESTAMPTZ;

-- Public rendering looks media rows up by their public `url` to attach srcset;
-- keep that lookup indexed alongside the existing site scope.
CREATE INDEX IF NOT EXISTS idx_media_site_url ON media(site_id, url);

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0028_site_search
-- -----------------------------------------------------------------------------

-- Shared live-row index; draft rows are only eligible for authorized admin queries.
CREATE TABLE IF NOT EXISTS search_documents (
  content_id UUID PRIMARY KEY REFERENCES content(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', title), 'A') ||
    setweight(to_tsvector('simple', slug), 'B') ||
    setweight(to_tsvector('simple', summary), 'C') ||
    setweight(to_tsvector('simple', body), 'D')
  ) STORED
);
CREATE INDEX IF NOT EXISTS search_documents_fts ON search_documents USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS search_documents_site ON search_documents(site_id);

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0029_search_metrics
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS search_metrics (
  id UUID PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  token_count INTEGER NOT NULL,
  result_count INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS search_metrics_site_created ON search_metrics (site_id, created_at);

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0030_content_scheduling
-- -----------------------------------------------------------------------------

ALTER TYPE content_status ADD VALUE IF NOT EXISTS 'scheduled';
ALTER TABLE content ADD COLUMN publish_on TIMESTAMPTZ;
ALTER TABLE content ADD COLUMN unpublish_on TIMESTAMPTZ;
ALTER TABLE content ADD COLUMN schedule_actor_id UUID;
CREATE INDEX content_publish_due ON content (publish_on);
CREATE INDEX content_unpublish_due ON content (unpublish_on);
CREATE TABLE content_schedule_events (
  id UUID PRIMARY KEY,
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event VARCHAR(40) NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX content_schedule_events_created ON content_schedule_events (created_at);

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0031_comment_spam
-- -----------------------------------------------------------------------------

-- Comment spam filtering and submission throttling (#109).
ALTER TABLE comments ADD COLUMN IF NOT EXISTS spam_score REAL;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS spam_reasons TEXT;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS held_reason VARCHAR(40);

CREATE TABLE IF NOT EXISTS comment_moderation_rules (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  list         VARCHAR(10)   NOT NULL,
  field        VARCHAR(20)   NOT NULL,
  pattern      VARCHAR(500)  NOT NULL,
  note         VARCHAR(500),
  created_by   UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  hit_count    INT           NOT NULL DEFAULT 0,
  last_hit_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_comment_rules_site ON comment_moderation_rules(site_id, list, field);

CREATE TABLE IF NOT EXISTS comment_spam_terms (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind       VARCHAR(10)  NOT NULL,
  value      VARCHAR(255) NOT NULL,
  weight     REAL         NOT NULL DEFAULT 1,
  hits       INT          NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, kind, value)
);
CREATE INDEX IF NOT EXISTS idx_comment_spam_terms_site ON comment_spam_terms(site_id, kind, value);

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0032_comment_trash_repair
-- -----------------------------------------------------------------------------

-- Repair: on some MySQL/MariaDB installs, the `original_status` column that
-- 0021_trash_retention adds to `content` and `comments` silently failed to
-- apply (a duplicate-column error the migration runner treats as idempotent
-- masked a real failure). This is a no-op on an install where the column is
-- already present.
ALTER TABLE content ADD COLUMN IF NOT EXISTS original_status content_status;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS original_status VARCHAR(20);

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0033_spam_term_source
-- -----------------------------------------------------------------------------

-- Distinguish admin-curated spam-signal terms from ones the "mark as spam"
-- feedback loop trained automatically, so training never overwrites an
-- admin's manual entry and the admin UI can show provenance.
ALTER TABLE comment_spam_terms ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'trained';

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0034_user_role_text
-- -----------------------------------------------------------------------------

-- Plugin-registered roles (Shop's customer, for example) are stored on
-- users.role. The column was a closed enum; widen it so a plugin can add a
-- role without another core migration.
ALTER TABLE users ALTER COLUMN role DROP DEFAULT;
ALTER TABLE users ALTER COLUMN role TYPE varchar(32) USING role::text;
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'subscriber';
ALTER TABLE users ALTER COLUMN role SET NOT NULL;
DROP TYPE IF EXISTS user_role;

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0035_user_additional_roles
-- -----------------------------------------------------------------------------

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

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0036_ai_byok
-- -----------------------------------------------------------------------------

-- 0036_ai_byok
-- Bring your own AI (#159): the MCP server's OAuth 2.1 authorization server,
-- stored AI provider credentials for the in-admin assistant, and MCP
-- attribution on revisions.
--
-- Every token, code and client secret is stored only as a SHA-256 hash.
-- Provider API keys are stored encrypted with secret-box (`enc:v1:`), never in
-- plaintext; only the last four characters are kept readable for the UI.

-- An API key or OAuth grant must opt in to the users & roles tools explicitly,
-- even when its owner holds users:manage.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS mcp_user_tools BOOLEAN NOT NULL DEFAULT FALSE;

-- Where a revision came from: NULL for the admin UI, 'mcp' for an MCP client,
-- 'assistant' for the in-admin assistant. `via_client` is the client's name
-- ("Claude", "Cursor") so history can say "Edited by Dirk via Claude".
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS via VARCHAR(16);
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS via_client VARCHAR(120);

-- One row per provider per scope. `scope_key` is 'site' for the site-wide key
-- or 'user:<user id>' for a personal key, so a single unique index covers both
-- without relying on how each engine treats NULL in a unique constraint.
CREATE TABLE IF NOT EXISTS ai_provider_credentials (
  id            UUID          PRIMARY KEY,
  site_id       UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id       UUID          REFERENCES users(id) ON DELETE CASCADE,
  scope_key     VARCHAR(48)   NOT NULL,
  provider      VARCHAR(32)   NOT NULL,
  label         VARCHAR(120),
  api_key_enc   TEXT          NOT NULL,
  key_last4     VARCHAR(8)    NOT NULL,
  base_url      VARCHAR(500),
  organization  VARCHAR(120),
  project       VARCHAR(120),
  models_json   TEXT          NOT NULL DEFAULT '[]',
  default_model VARCHAR(200),
  enabled       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_by    UUID,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_provider_credentials_scope
  ON ai_provider_credentials (site_id, scope_key, provider);
CREATE INDEX IF NOT EXISTS idx_ai_provider_credentials_user ON ai_provider_credentials (user_id);

-- Per-user daily assistant usage, for the optional daily request limit and the
-- token totals shown to the user.
CREATE TABLE IF NOT EXISTS ai_usage_daily (
  site_id       UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id       UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_day     VARCHAR(10)   NOT NULL,
  requests      INTEGER       NOT NULL DEFAULT 0,
  input_tokens  BIGINT        NOT NULL DEFAULT 0,
  output_tokens BIGINT        NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_day)
);

-- Dynamically registered OAuth clients (RFC 7591). `client_id` is the public
-- identifier; public clients (`token_endpoint_auth_method = 'none'`) have no
-- secret and rely on PKCE.
CREATE TABLE IF NOT EXISTS oauth_clients (
  id                          UUID          PRIMARY KEY,
  site_id                     UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  client_id                   VARCHAR(64)   NOT NULL UNIQUE,
  client_secret_hash          VARCHAR(128),
  client_name                 VARCHAR(120)  NOT NULL,
  client_uri                  VARCHAR(500),
  redirect_uris_json          TEXT          NOT NULL,
  token_endpoint_auth_method  VARCHAR(32)   NOT NULL DEFAULT 'none',
  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_used_at                TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_site ON oauth_clients (site_id);

-- A user's consent for one client: the capability set they granted (never more
-- than they had, and re-intersected with their current access on every call).
CREATE TABLE IF NOT EXISTS oauth_grants (
  id                UUID          PRIMARY KEY,
  site_id           UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  client_id         UUID          NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id           UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capabilities_json TEXT          NOT NULL DEFAULT '[]',
  mcp_user_tools    BOOLEAN       NOT NULL DEFAULT FALSE,
  resource          VARCHAR(500)  NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_used_at      TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_oauth_grants_site ON oauth_grants (site_id);
CREATE INDEX IF NOT EXISTS idx_oauth_grants_user ON oauth_grants (user_id);

-- Single-use authorization codes, valid for a few minutes.
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash       VARCHAR(128)  PRIMARY KEY,
  grant_id        UUID          NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  redirect_uri    VARCHAR(2000) NOT NULL,
  code_challenge  VARCHAR(128)  NOT NULL,
  resource        VARCHAR(500)  NOT NULL,
  expires_at      TIMESTAMPTZ   NOT NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Access and refresh tokens. A refresh token is single-use: presenting one that
-- was already rotated (`used_at` set) revokes the whole grant.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id          UUID          PRIMARY KEY,
  token_hash  VARCHAR(128)  NOT NULL UNIQUE,
  kind        VARCHAR(16)   NOT NULL,
  grant_id    UUID          NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  resource    VARCHAR(500)  NOT NULL,
  expires_at  TIMESTAMPTZ   NOT NULL,
  used_at     TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_grant ON oauth_tokens (grant_id);
