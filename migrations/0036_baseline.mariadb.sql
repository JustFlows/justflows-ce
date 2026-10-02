
-- -----------------------------------------------------------------------------
-- Consolidated migration: 0001_initial
-- -----------------------------------------------------------------------------

-- Justflows initial schema — MySQL 8+ / MariaDB 10.6+
-- Run automatically by the install wizard.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS sites (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  name         VARCHAR(255)  NOT NULL,
  url          VARCHAR(2048) NOT NULL,
  description  TEXT,
  active       TINYINT(1)    NOT NULL DEFAULT 1,
  installed_at DATETIME,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sites_url (url(512))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  site_id       CHAR(36)     NOT NULL,
  email         VARCHAR(320) NOT NULL,
  username      VARCHAR(60)  NOT NULL,
  display_name  VARCHAR(255) NOT NULL,
  password_hash TEXT         NOT NULL,
  role          ENUM('administrator','editor','author','contributor','subscriber') NOT NULL DEFAULT 'subscriber',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_site_email (site_id, email),
  UNIQUE KEY uq_users_site_username (site_id, username),
  KEY idx_users_site_id (site_id),
  CONSTRAINT fk_users_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  site_id      CHAR(36)      NOT NULL,
  type         VARCHAR(60)   NOT NULL DEFAULT 'post',
  title        VARCHAR(1024) NOT NULL,
  slug         VARCHAR(1024) NOT NULL,
  excerpt      TEXT,
  blocks       LONGTEXT      NOT NULL,
  fields       LONGTEXT      NOT NULL DEFAULT ('{}'),
  status       ENUM('draft','published','unpublished','trashed') NOT NULL DEFAULT 'draft',
  author_id    CHAR(36),
  published_at DATETIME,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_content_site_id (site_id),
  KEY idx_content_status (status),
  KEY idx_content_type (type),
  KEY idx_content_published_at (published_at),
  UNIQUE KEY uq_content_slug (site_id, type, slug(200)),
  CONSTRAINT fk_content_site   FOREIGN KEY (site_id)   REFERENCES sites(id)  ON DELETE CASCADE,
  CONSTRAINT fk_content_author FOREIGN KEY (author_id) REFERENCES users(id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_settings (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  site_id    CHAR(36)     NOT NULL,
  `key`      VARCHAR(255) NOT NULL,
  value      LONGTEXT,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_settings (site_id, `key`),
  KEY idx_site_settings_site_id (site_id),
  CONSTRAINT fk_settings_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plugins (
  id                   CHAR(36)     NOT NULL PRIMARY KEY,
  site_id              CHAR(36)     NOT NULL,
  plugin_id            VARCHAR(255) NOT NULL,
  version              VARCHAR(50)  NOT NULL,
  status               ENUM('installed','active','inactive','error') NOT NULL DEFAULT 'installed',
  manifest             LONGTEXT     NOT NULL,
  approved_permissions LONGTEXT     NOT NULL,
  safe_mode            TINYINT(1)   NOT NULL DEFAULT 0,
  installed_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at         DATETIME,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_plugins (site_id, plugin_id),
  KEY idx_plugins_site_id (site_id),
  KEY idx_plugins_status (status),
  CONSTRAINT fk_plugins_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS _migrations (
  id         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL UNIQUE,
  applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS themes (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  site_id       CHAR(36)     NOT NULL,
  theme_id      VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  version       VARCHAR(50)  NOT NULL,
  publisher     VARCHAR(255) NOT NULL DEFAULT '',
  description   TEXT,
  status        ENUM('installed','active','inactive','error') NOT NULL DEFAULT 'installed',
  css_variables LONGTEXT     NOT NULL DEFAULT ('{}'),
  manifest      LONGTEXT     NOT NULL DEFAULT ('{}'),
  installed_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at  DATETIME,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_themes (site_id, theme_id),
  KEY idx_themes_site_id (site_id),
  KEY idx_themes_status (status),
  CONSTRAINT fk_themes_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS media (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  site_id      CHAR(36)     NOT NULL,
  filename     VARCHAR(512) NOT NULL,
  mime_type    VARCHAR(128) NOT NULL,
  size_bytes   BIGINT       NOT NULL,
  storage_key  TEXT         NOT NULL,
  url          TEXT         NOT NULL,
  alt_text     TEXT,
  caption      TEXT,
  width        INT,
  height       INT,
  derivatives  LONGTEXT     NOT NULL DEFAULT ('{}'),
  uploaded_by  CHAR(36),
  uploaded_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_media_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_media_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS revisions (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  content_id   CHAR(36)      NOT NULL,
  site_id      CHAR(36)      NOT NULL,
  title        VARCHAR(1024) NOT NULL,
  blocks       LONGTEXT      NOT NULL,
  fields       LONGTEXT      NOT NULL DEFAULT ('{}'),
  version      INT           NOT NULL DEFAULT 1,
  created_by   CHAR(36),
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_revisions_content FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
  CONSTRAINT fk_revisions_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_revisions_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS taxonomies (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  site_id      CHAR(36)     NOT NULL,
  slug         VARCHAR(255) NOT NULL,
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  hierarchical TINYINT(1)   NOT NULL DEFAULT 0,
  UNIQUE KEY uq_taxonomy_slug (site_id, slug),
  CONSTRAINT fk_taxonomy_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS terms (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  site_id      CHAR(36)     NOT NULL,
  taxonomy_id  CHAR(36)     NOT NULL,
  slug         VARCHAR(255) NOT NULL,
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  parent_id    CHAR(36),
  UNIQUE KEY uq_term_slug (taxonomy_id, slug),
  CONSTRAINT fk_terms_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_terms_taxonomy FOREIGN KEY (taxonomy_id) REFERENCES taxonomies(id) ON DELETE CASCADE,
  CONSTRAINT fk_terms_parent FOREIGN KEY (parent_id) REFERENCES terms(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_terms (
  content_id CHAR(36) NOT NULL,
  term_id    CHAR(36) NOT NULL,
  PRIMARY KEY (content_id, term_id),
  CONSTRAINT fk_content_terms_content FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
  CONSTRAINT fk_content_terms_term FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menus (
  id       CHAR(36)     NOT NULL PRIMARY KEY,
  site_id  CHAR(36)     NOT NULL,
  slug     VARCHAR(255) NOT NULL,
  name     VARCHAR(255) NOT NULL,
  items    LONGTEXT     NOT NULL,
  UNIQUE KEY uq_menu_slug (site_id, slug),
  CONSTRAINT fk_menus_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comments (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  site_id      CHAR(36)     NOT NULL,
  content_id   CHAR(36)     NOT NULL,
  parent_id    CHAR(36),
  author_name  VARCHAR(255) NOT NULL,
  author_email VARCHAR(320),
  author_url   TEXT,
  body         TEXT         NOT NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'pending',
  user_id      CHAR(36),
  ip_address   VARCHAR(64),
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_comments_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_content FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_parent FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jobs (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  site_id      CHAR(36),
  name         VARCHAR(255) NOT NULL,
  payload      LONGTEXT     NOT NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'pending',
  attempts     INT          NOT NULL DEFAULT 0,
  max_attempts INT          NOT NULL DEFAULT 3,
  run_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at   DATETIME,
  completed_at DATETIME,
  failed_at    DATETIME,
  error        TEXT,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_jobs_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  site_id    CHAR(36)     NOT NULL,
  user_id    CHAR(36),
  action     VARCHAR(255) NOT NULL,
  target     VARCHAR(255),
  target_id  CHAR(36),
  metadata   LONGTEXT     NOT NULL,
  ip_address VARCHAR(64),
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

INSERT IGNORE INTO _migrations (name) VALUES ('0001_initial');


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0002_multilingual
-- -----------------------------------------------------------------------------

-- Justflows multilingual support — MariaDB

CREATE TABLE IF NOT EXISTS languages (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  site_id      CHAR(36)     NOT NULL,
  code         VARCHAR(20)  NOT NULL,
  name         VARCHAR(100) NOT NULL,
  native_name  VARCHAR(100) NOT NULL,
  is_default   TINYINT(1)   NOT NULL DEFAULT 0,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order   INT          NOT NULL DEFAULT 0,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_languages_site_code (site_id, code),
  KEY idx_languages_site_id (site_id),
  CONSTRAINT fk_languages_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE content ADD COLUMN locale VARCHAR(20) NOT NULL DEFAULT 'en';
ALTER TABLE content ADD COLUMN translation_group_id CHAR(36) NULL;

ALTER TABLE content DROP INDEX IF EXISTS uq_content_slug;
ALTER TABLE content ADD UNIQUE KEY uq_content_slug_locale (site_id, type, slug(200), locale);
ALTER TABLE content ADD KEY idx_content_locale (locale);
ALTER TABLE content ADD KEY idx_content_translation_group (translation_group_id);


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0003_css_providers
-- -----------------------------------------------------------------------------

-- Justflows CSS providers — MariaDB

CREATE TABLE IF NOT EXISTS css_providers (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  site_id       CHAR(36)     NOT NULL,
  provider_id   VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  version       VARCHAR(50)  NOT NULL,
  publisher     VARCHAR(255) NOT NULL DEFAULT '',
  description   TEXT,
  status        ENUM('installed','active','inactive','error') NOT NULL DEFAULT 'installed',
  manifest      JSON         NOT NULL DEFAULT (JSON_OBJECT()),
  installed_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at  DATETIME,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_css_providers (site_id, provider_id),
  KEY idx_css_providers_site_id (site_id),
  KEY idx_css_providers_status (status),
  CONSTRAINT fk_css_providers_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0004_plugin_data
-- -----------------------------------------------------------------------------

-- Justflows plugin-scoped JSON documents — MariaDB

CREATE TABLE IF NOT EXISTS plugin_data (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  site_id     CHAR(36)     NOT NULL,
  plugin_id   VARCHAR(255) NOT NULL,
  collection  VARCHAR(100) NOT NULL,
  item_id     VARCHAR(255) NOT NULL,
  payload     JSON         NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_plugin_data (site_id, plugin_id, collection, item_id),
  KEY idx_plugin_data_lookup (site_id, plugin_id, collection),
  CONSTRAINT fk_plugin_data_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0005_content_types
-- -----------------------------------------------------------------------------

-- Justflows persisted content type definitions — MariaDB

CREATE TABLE IF NOT EXISTS content_types (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  site_id      CHAR(36)     NOT NULL,
  slug         VARCHAR(60)  NOT NULL,
  label        VARCHAR(255) NOT NULL,
  description  TEXT         NOT NULL,
  is_builtin   TINYINT(1)   NOT NULL DEFAULT 0,
  fields       JSON         NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_content_types (site_id, slug),
  KEY idx_content_types_site_id (site_id),
  CONSTRAINT fk_content_types_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0006_session_revocation
-- -----------------------------------------------------------------------------

-- Justflows session revocation counter — mariadb
--
-- Session tokens are stateless HMACs, so logging out only clears the cookie and
-- a captured token stays valid for its full lifetime. This counter is embedded
-- in the token and compared on every request, which is what lets a password
-- change or an explicit "sign out everywhere" take effect immediately.
--
-- MySQL 8.0 has no ADD COLUMN IF NOT EXISTS; a duplicate-column error on re-run
-- is treated as ignorable by run-migrations.ts.

ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 0;


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0007_totp
-- -----------------------------------------------------------------------------

-- Justflows two-factor authentication (TOTP) — mariadb
--
-- An administrator who can upload a .jfpkg or a core .zip can run code on the
-- server, so a single password is the only thing in front of shell access.
--
-- The secret is stored encrypted (secret-box, AES-256-GCM under a key derived
-- from APP_SECRET). totp_confirmed_at stays NULL until the user proves they can
-- generate a code, so an interrupted enrolment cannot lock anyone out.
--
-- MySQL 8.0 has no ADD COLUMN IF NOT EXISTS; a duplicate-column error on re-run
-- is treated as ignorable by run-migrations.ts.

ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_confirmed_at DATETIME NULL;
ALTER TABLE users ADD COLUMN totp_recovery_codes TEXT;


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0008_audit_log
-- -----------------------------------------------------------------------------

-- Justflows administrative audit log — mariadb
--
-- There was no record of who signed in, who changed a role, who uploaded a
-- package or who altered the security-header policy. For an administrator role
-- the project documents as equivalent to shell access, that means a compromise
-- cannot be reconstructed afterwards.
--
-- actor_id is intentionally NOT a foreign key: deleting a user must not delete
-- the record of what that user did.

CREATE TABLE IF NOT EXISTS audit_log (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  site_id     CHAR(36)     NOT NULL,
  occurred_at DATETIME     NOT NULL,
  action      VARCHAR(64)  NOT NULL,
  outcome     VARCHAR(16)  NOT NULL DEFAULT 'success',
  actor_id    CHAR(36)     NULL,
  actor_email VARCHAR(320) NULL,
  actor_role  VARCHAR(32)  NULL,
  target      VARCHAR(255) NULL,
  ip          VARCHAR(64)  NULL,
  user_agent  VARCHAR(255) NULL,
  detail      TEXT         NULL,
  KEY idx_audit_log_site_time (site_id, occurred_at),
  KEY idx_audit_log_action (site_id, action),
  CONSTRAINT fk_audit_log_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0009_audit_log_compat
-- -----------------------------------------------------------------------------

-- Repair audit_log installations upgraded from the legacy 0001 schema.
-- Statements are intentionally separate: the migration runner ignores a
-- duplicate-column error when 0008 already created the new table shape.

ALTER TABLE audit_log ADD COLUMN occurred_at DATETIME NULL;
ALTER TABLE audit_log ADD COLUMN outcome VARCHAR(16) NOT NULL DEFAULT 'success';
ALTER TABLE audit_log ADD COLUMN actor_id CHAR(36) NULL;
ALTER TABLE audit_log ADD COLUMN actor_email VARCHAR(320) NULL;
ALTER TABLE audit_log ADD COLUMN actor_role VARCHAR(32) NULL;
ALTER TABLE audit_log ADD COLUMN ip VARCHAR(64) NULL;
ALTER TABLE audit_log ADD COLUMN user_agent VARCHAR(255) NULL;
ALTER TABLE audit_log ADD COLUMN detail TEXT NULL;
ALTER TABLE audit_log ADD COLUMN metadata JSON NULL;
ALTER TABLE audit_log ADD COLUMN user_id CHAR(36) NULL;
ALTER TABLE audit_log ADD COLUMN ip_address VARCHAR(64) NULL;
ALTER TABLE audit_log ADD COLUMN created_at DATETIME NULL;

UPDATE audit_log
SET occurred_at = COALESCE(occurred_at, created_at, CURRENT_TIMESTAMP),
    actor_id = COALESCE(actor_id, user_id),
    ip = COALESCE(ip, ip_address)
WHERE occurred_at IS NULL OR actor_id IS NULL OR ip IS NULL;
ALTER TABLE audit_log MODIFY occurred_at DATETIME NOT NULL;

ALTER TABLE audit_log ADD KEY idx_audit_log_site_time (site_id, occurred_at);
ALTER TABLE audit_log ADD KEY idx_audit_log_action (site_id, action);


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0010_content_revisions
-- -----------------------------------------------------------------------------

-- Justflows working content revisions — MariaDB
--
-- Do not ADD FOREIGN KEY or STORED generated unique columns on `revisions`.
-- InnoDB copies the table for those ALTERs and then fails with
-- errno 121 ("Duplicate key on write or update") because the existing
-- fk_revisions_* names from 0001_initial are already in the dictionary.
-- One working/autosave row per content item is enforced in application
-- upserts; PostgreSQL keeps partial unique indexes for the same invariant.

ALTER TABLE content ADD COLUMN version INT NOT NULL DEFAULT 1;

ALTER TABLE revisions ADD COLUMN slug VARCHAR(1024) NOT NULL DEFAULT '';
ALTER TABLE revisions ADD COLUMN excerpt TEXT;
ALTER TABLE revisions ADD COLUMN locale VARCHAR(20);
ALTER TABLE revisions ADD COLUMN translation_group_id CHAR(36);
ALTER TABLE revisions ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'historical';
ALTER TABLE revisions ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'manual';
ALTER TABLE revisions ADD COLUMN base_version INT NOT NULL DEFAULT 1;
ALTER TABLE revisions ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE revisions ADD COLUMN updated_by CHAR(36);
ALTER TABLE revisions ADD KEY idx_revisions_kind_created (content_id, kind, created_at);


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0011_default_locale_en_us
-- -----------------------------------------------------------------------------

-- Remap the seeded language-only English tag to en-US.

UPDATE content c
LEFT JOIN content o
  ON o.site_id = c.site_id AND o.type = c.type AND o.slug = c.slug AND o.locale = 'en-US'
SET c.locale = 'en-US'
WHERE c.locale = 'en' AND o.id IS NULL;

UPDATE revisions SET locale = 'en-US' WHERE locale = 'en';

UPDATE languages l
LEFT JOIN languages x
  ON x.site_id = l.site_id AND x.code = 'en-US'
SET l.code = 'en-US'
WHERE l.code = 'en' AND x.id IS NULL;

DELETE l FROM languages l
INNER JOIN languages keep ON keep.site_id = l.site_id AND keep.code = 'en-US'
LEFT JOIN content c ON c.site_id = l.site_id AND c.locale = 'en'
WHERE l.code = 'en' AND c.id IS NULL;

ALTER TABLE content MODIFY locale VARCHAR(20) NOT NULL DEFAULT 'en-US';


-- -----------------------------------------------------------------------------
-- Consolidated migration: 0012_template_parts
-- -----------------------------------------------------------------------------

-- Justflows template parts — MariaDB

CREATE TABLE IF NOT EXISTS template_parts (
  id         CHAR(36)    NOT NULL PRIMARY KEY,
  site_id    CHAR(36)    NOT NULL,
  part       VARCHAR(40) NOT NULL,
  doc        JSON        NOT NULL,
  draft_doc  JSON,
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_template_parts (site_id, part),
  KEY idx_template_parts_site (site_id),
  CONSTRAINT fk_template_parts_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0013_public_comments
-- -----------------------------------------------------------------------------

-- Justflows public comments — MySQL
--
-- Adds opt-in reply notifications, an unsubscribe token, a moderator-edit
-- marker, and the indexes the public thread query and reply lookups need.
-- MySQL 8 has no ADD COLUMN / CREATE INDEX IF NOT EXISTS; the migration runner
-- treats "duplicate column" / "duplicate key name" as ignorable on re-run.

ALTER TABLE comments ADD COLUMN notify TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE comments ADD COLUMN unsubscribe_token VARCHAR(64) NULL;
ALTER TABLE comments ADD COLUMN edited_at DATETIME NULL;

CREATE INDEX idx_comments_thread
  ON comments (site_id, content_id, status, created_at);
CREATE INDEX idx_comments_parent
  ON comments (parent_id);
CREATE INDEX idx_comments_unsubscribe
  ON comments (unsubscribe_token);

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0014_content_webhooks
-- -----------------------------------------------------------------------------

-- Justflows content webhooks — MySQL

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id VARCHAR(36) PRIMARY KEY,
  site_id VARCHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  events TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_webhook_endpoints_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  INDEX idx_webhook_endpoints_site (site_id, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id VARCHAR(36) PRIMARY KEY,
  endpoint_id VARCHAR(36) NOT NULL,
  site_id VARCHAR(36) NOT NULL,
  event VARCHAR(160) NOT NULL,
  payload LONGTEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempt_count INT NOT NULL DEFAULT 0,
  response_status INT NULL,
  response_body VARCHAR(2048) NULL,
  error VARCHAR(1024) NULL,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_webhook_deliveries_endpoint FOREIGN KEY (endpoint_id) REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  CONSTRAINT fk_webhook_deliveries_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  INDEX idx_webhook_deliveries_due (status, next_attempt_at),
  INDEX idx_webhook_deliveries_endpoint (endpoint_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0015_theme_designs
-- -----------------------------------------------------------------------------

-- Justflows theme designs — MySQL
--
-- Per-theme Customizer mods / homepage / blog design documents move out of
-- site_settings into their own table. One row per (site, theme, kind).

CREATE TABLE IF NOT EXISTS theme_designs (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  site_id    CHAR(36)     NOT NULL,
  theme_id   VARCHAR(255) NOT NULL,
  kind       VARCHAR(40)  NOT NULL,
  doc        JSON         NOT NULL,
  draft_doc  JSON,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_theme_designs (site_id, theme_id, kind),
  KEY idx_theme_designs_site (site_id, theme_id),
  CONSTRAINT fk_theme_designs_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0016_user_preferences
-- -----------------------------------------------------------------------------

-- Justflows user preferences — MySQL
--
-- Per-user administration preferences — the dashboard welcome/discovery panel
-- state today, and future personal toggles. One JSON row per (user, key).

CREATE TABLE IF NOT EXISTS user_preferences (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  user_id    CHAR(36)     NOT NULL,
  `key`      VARCHAR(255) NOT NULL,
  value      JSON,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_preferences (user_id, `key`),
  KEY idx_user_preferences_user (user_id),
  CONSTRAINT fk_user_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0017_password_resets
-- -----------------------------------------------------------------------------

-- Justflows self-service password recovery — MySQL and MariaDB
--
-- One row per outstanding "forgot password" request (#93). Only the SHA-256 hash
-- of the single-use token is stored; the token itself is mailed to the account
-- and never persisted. Rows are single-use (used_at), time-limited (expires_at),
-- bound to one account, and cleared on a successful reset or any password
-- change. Neither engine has CREATE INDEX IF NOT EXISTS; the migration runner
-- treats "table already exists" / "duplicate key name" as ignorable on re-run.
-- MariaDB reuses this file (see migrationFileCandidates in run-migrations.ts).

CREATE TABLE IF NOT EXISTS password_resets (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  user_id      CHAR(36)     NOT NULL,
  site_id      CHAR(36)     NOT NULL,
  token_hash   CHAR(64)     NOT NULL,
  requested_ip VARCHAR(64),
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME     NOT NULL,
  used_at      DATETIME,
  UNIQUE KEY uq_password_resets_token (token_hash),
  KEY idx_password_resets_user (user_id),
  KEY idx_password_resets_expires (expires_at),
  CONSTRAINT fk_password_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_password_resets_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0018_access_control
-- -----------------------------------------------------------------------------

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

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0019_device_sessions
-- -----------------------------------------------------------------------------

-- 0019_device_sessions — MySQL and MariaDB (#54)
CREATE TABLE IF NOT EXISTS user_sessions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  site_id CHAR(36) NOT NULL,
  user_agent VARCHAR(255),
  ip VARCHAR(64),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME,
  KEY idx_user_sessions_user (user_id, site_id),
  CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_sessions_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0020_email_delivery
-- -----------------------------------------------------------------------------

-- 0020_email_delivery — outbound email operations (#104), MySQL and MariaDB
CREATE TABLE IF NOT EXISTS email_deliveries (
  id CHAR(36) NOT NULL PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  message_type VARCHAR(80) NOT NULL,
  recipient_masked VARCHAR(320) NOT NULL,
  recipient_hash VARCHAR(64) NOT NULL,
  recipient_encrypted TEXT NOT NULL,
  message_encrypted TEXT NOT NULL,
  subject VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL,
  transport VARCHAR(120) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  provider_response TEXT,
  error_detail TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME,
  next_attempt_at DATETIME,
  KEY idx_email_deliveries_site_created (site_id, created_at),
  KEY idx_email_deliveries_retry (status, next_attempt_at),
  CONSTRAINT fk_email_deliveries_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_suppressions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  email_hash VARCHAR(64) NOT NULL,
  email_masked VARCHAR(320) NOT NULL,
  message_type VARCHAR(80) NOT NULL,
  reason VARCHAR(500),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email_suppressions (site_id, email_hash, message_type),
  CONSTRAINT fk_email_suppressions_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0021_trash_retention
-- -----------------------------------------------------------------------------

-- Recoverable deletion for site-owned content (MySQL and MariaDB).
ALTER TABLE content ADD COLUMN trashed_at DATETIME NULL;
ALTER TABLE content ADD COLUMN trashed_by CHAR(36) NULL;
ALTER TABLE content ADD COLUMN original_slug VARCHAR(1024) NULL;
ALTER TABLE content ADD COLUMN original_status VARCHAR(20) NULL;
ALTER TABLE content ADD CONSTRAINT fk_content_trashed_by FOREIGN KEY (trashed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE media ADD COLUMN trashed_at DATETIME NULL;
ALTER TABLE media ADD COLUMN trashed_by CHAR(36) NULL;
ALTER TABLE media ADD CONSTRAINT fk_media_trashed_by FOREIGN KEY (trashed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE comments ADD COLUMN trashed_at DATETIME NULL;
ALTER TABLE comments ADD COLUMN trashed_by CHAR(36) NULL;
ALTER TABLE comments ADD COLUMN original_status VARCHAR(20) NULL;
ALTER TABLE comments ADD CONSTRAINT fk_comments_trashed_by FOREIGN KEY (trashed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE menus ADD COLUMN trashed_at DATETIME NULL;
ALTER TABLE menus ADD COLUMN trashed_by CHAR(36) NULL;
ALTER TABLE menus ADD COLUMN original_slug VARCHAR(255) NULL;
ALTER TABLE menus ADD CONSTRAINT fk_menus_trashed_by FOREIGN KEY (trashed_by) REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_content_trash ON content(site_id, trashed_at);
CREATE INDEX idx_media_trash ON media(site_id, trashed_at);
CREATE INDEX idx_comments_trash ON comments(site_id, trashed_at);
CREATE INDEX idx_menus_trash ON menus(site_id, trashed_at);

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0022_email_templates
-- -----------------------------------------------------------------------------

-- 0022_email_templates — versioned system email design and templates (#63), MySQL and MariaDB
CREATE TABLE IF NOT EXISTS email_design_versions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  version INT NOT NULL,
  status VARCHAR(20) NOT NULL,
  design LONGTEXT NOT NULL,
  created_by CHAR(36),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME,
  UNIQUE KEY uq_email_design_version (site_id, version),
  KEY idx_email_design_site_status (site_id, status),
  CONSTRAINT fk_email_design_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_email_design_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_template_versions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  template_key VARCHAR(160) NOT NULL,
  owner VARCHAR(160) NOT NULL,
  locale VARCHAR(20) NOT NULL,
  version INT NOT NULL,
  status VARCHAR(20) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sender_name VARCHAR(120),
  reply_to_policy VARCHAR(20) NOT NULL DEFAULT 'global',
  subject VARCHAR(500) NOT NULL,
  preheader VARCHAR(500) NOT NULL DEFAULT '',
  html_content LONGTEXT NOT NULL,
  text_content LONGTEXT NOT NULL,
  created_by CHAR(36),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME,
  UNIQUE KEY uq_email_template_version (site_id, template_key, locale, version),
  KEY idx_email_template_lookup (site_id, template_key, locale, status),
  CONSTRAINT fk_email_template_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_email_template_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0023_templates
-- -----------------------------------------------------------------------------

-- Justflows theme template overrides — MySQL and MariaDB
--
-- Per-site edited copies of a theme's `templates/<slug>.json`. One row per
-- (site, theme, slug); `doc` is published, `draft_doc` the working copy.

CREATE TABLE IF NOT EXISTS theme_templates (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  site_id    CHAR(36)     NOT NULL,
  theme_id   VARCHAR(255) NOT NULL,
  slug       VARCHAR(120) NOT NULL,
  doc        JSON         NOT NULL,
  draft_doc  JSON,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_theme_templates (site_id, theme_id, slug),
  KEY idx_theme_templates_site (site_id, theme_id),
  CONSTRAINT fk_theme_templates_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0024_menu_designer
-- -----------------------------------------------------------------------------

-- Menu designer layout/design contract and draft/publish split (MySQL and
-- MariaDB). See 0024_menu_designer.sql for the column semantics. MySQL 8 has
-- no ADD COLUMN IF NOT EXISTS; the migration runner treats "duplicate column"
-- as ignorable on re-run (same idiom as 0021_trash_retention.mysql.sql).
ALTER TABLE menus ADD COLUMN design JSON NULL;
ALTER TABLE menus ADD COLUMN draft_items JSON NULL;
ALTER TABLE menus ADD COLUMN draft_design JSON NULL;
ALTER TABLE menus ADD COLUMN schema_version INT NOT NULL DEFAULT 1;

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0025_redirect_manager
-- -----------------------------------------------------------------------------

-- MySQL and MariaDB equivalent of 0025_redirect_manager.sql.
CREATE TABLE IF NOT EXISTS redirects (
  id CHAR(36) PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  rule TEXT NOT NULL,
  INDEX idx_redirects_site (site_id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS redirect_not_found (
  site_id CHAR(36) NOT NULL,
  path_hash VARCHAR(64) NOT NULL,
  path VARCHAR(2048) NOT NULL,
  hits BIGINT NOT NULL DEFAULT 1,
  referrer VARCHAR(512) NOT NULL DEFAULT '',
  first_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, path_hash),
  INDEX idx_redirect_not_found_seen (site_id, last_seen),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0026_api_keys
-- -----------------------------------------------------------------------------

-- Revocable API keys for the headless federated management API (#135) — MySQL
-- and MariaDB. See 0026_api_keys.sql for column semantics. MySQL 8 has no
-- ADD COLUMN IF NOT EXISTS; the migration runner treats "duplicate column" as
-- ignorable on re-run (same idiom as 0024_menu_designer.mysql.sql).

CREATE TABLE IF NOT EXISTS api_keys (
  id VARCHAR(36) PRIMARY KEY,
  site_id VARCHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  key_prefix VARCHAR(16) NOT NULL,
  key_hash VARCHAR(128) NOT NULL UNIQUE,
  owner_user_id VARCHAR(36) NOT NULL,
  created_by VARCHAR(36) NOT NULL,
  capabilities_json TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  allowed_ips_json TEXT NOT NULL,
  allowed_origins_json TEXT NOT NULL,
  rate_limit_per_min INT NULL,
  expires_at DATETIME NULL,
  revoked_at DATETIME NULL,
  last_used_at DATETIME NULL,
  last_used_ip VARCHAR(64) NULL,
  request_count BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_api_keys_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_api_keys_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_api_keys_site (site_id),
  INDEX idx_api_keys_owner (owner_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE webhook_endpoints ADD COLUMN api_key_id VARCHAR(36) NULL;

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0027_media_responsive
-- -----------------------------------------------------------------------------

-- MySQL and MariaDB equivalent of 0027_media_responsive.sql.
-- ADD COLUMN has no portable IF NOT EXISTS on MySQL 8; the migration runner
-- treats the "duplicate column" error as idempotent on re-run.
ALTER TABLE media ADD COLUMN focal_x DOUBLE NULL;
ALTER TABLE media ADD COLUMN focal_y DOUBLE NULL;
ALTER TABLE media ADD COLUMN original_format VARCHAR(16) NULL;
ALTER TABLE media ADD COLUMN variants_generated_at DATETIME NULL;

-- `url` is TEXT, so the composite index needs a key-length prefix.
CREATE INDEX idx_media_site_url ON media (site_id, url(191));

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0028_site_search
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS search_documents (
  content_id CHAR(36) PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  summary TEXT NOT NULL,
  body LONGTEXT NOT NULL,
  indexed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  INDEX search_documents_site (site_id),
  FULLTEXT INDEX search_documents_fts (title, slug, summary, body),
  FULLTEXT INDEX search_documents_title (title),
  FULLTEXT INDEX search_documents_slug (slug),
  FULLTEXT INDEX search_documents_summary (summary)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0029_search_metrics
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS search_metrics (
  id CHAR(36) PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  token_count INTEGER NOT NULL,
  result_count INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  INDEX search_metrics_site_created (site_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0030_content_scheduling
-- -----------------------------------------------------------------------------

ALTER TABLE content MODIFY COLUMN status ENUM('draft','published','unpublished','trashed','scheduled') NOT NULL DEFAULT 'draft';
ALTER TABLE content ADD COLUMN publish_on DATETIME;
ALTER TABLE content ADD COLUMN unpublish_on DATETIME;
ALTER TABLE content ADD COLUMN schedule_actor_id CHAR(36);
CREATE INDEX content_publish_due ON content (publish_on);
CREATE INDEX content_unpublish_due ON content (unpublish_on);
CREATE TABLE content_schedule_events (
  id CHAR(36) PRIMARY KEY,
  content_id CHAR(36) NOT NULL,
  site_id CHAR(36) NOT NULL,
  event VARCHAR(40) NOT NULL,
  payload LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  INDEX content_schedule_events_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0031_comment_spam
-- -----------------------------------------------------------------------------

-- Comment spam filtering and submission throttling (#109) — MySQL and MariaDB.
ALTER TABLE comments ADD COLUMN spam_score FLOAT NULL;
ALTER TABLE comments ADD COLUMN spam_reasons TEXT NULL;
ALTER TABLE comments ADD COLUMN held_reason VARCHAR(40) NULL;

CREATE TABLE IF NOT EXISTS comment_moderation_rules (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  site_id     CHAR(36)     NOT NULL,
  list        VARCHAR(10)  NOT NULL,
  field       VARCHAR(20)  NOT NULL,
  pattern     VARCHAR(500) NOT NULL,
  note        VARCHAR(500),
  created_by  CHAR(36),
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  hit_count   INT          NOT NULL DEFAULT 0,
  last_hit_at DATETIME,
  INDEX idx_comment_rules_site (site_id, list, field),
  CONSTRAINT fk_comment_rules_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_comment_rules_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comment_spam_terms (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  site_id    CHAR(36)     NOT NULL,
  kind       VARCHAR(10)  NOT NULL,
  value      VARCHAR(255) NOT NULL,
  weight     FLOAT        NOT NULL DEFAULT 1,
  hits       INT          NOT NULL DEFAULT 1,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_comment_spam_terms (site_id, kind, value),
  INDEX idx_comment_spam_terms_site (site_id, kind, value),
  CONSTRAINT fk_comment_spam_terms_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0032_comment_trash_repair
-- -----------------------------------------------------------------------------

-- Repair: on some MySQL/MariaDB installs, the `original_status` column that
-- 0021_trash_retention adds to `content` and `comments` silently failed to
-- apply (a duplicate-column error the migration runner treats as idempotent
-- masked a real failure). Duplicate-column errors are caught and ignored by
-- the runner, so this is a no-op on an install where it is already present.
ALTER TABLE content ADD COLUMN original_status VARCHAR(20) NULL;
ALTER TABLE comments ADD COLUMN original_status VARCHAR(20) NULL;

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0033_spam_term_source
-- -----------------------------------------------------------------------------

-- Distinguish admin-curated spam-signal terms from ones the "mark as spam"
-- feedback loop trained automatically, so training never overwrites an
-- admin's manual entry and the admin UI can show provenance.
ALTER TABLE comment_spam_terms ADD COLUMN source VARCHAR(10) NOT NULL DEFAULT 'trained';

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0034_user_role_text
-- -----------------------------------------------------------------------------

-- Plugin-registered roles (Shop's customer, for example) are stored on
-- users.role. The column was a closed ENUM; widen it so a plugin can add a
-- role without another core migration.
ALTER TABLE users MODIFY COLUMN role VARCHAR(32) NOT NULL DEFAULT 'subscriber';

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0035_user_additional_roles
-- -----------------------------------------------------------------------------

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

-- -----------------------------------------------------------------------------
-- Consolidated migration: 0036_ai_byok
-- -----------------------------------------------------------------------------

-- 0036_ai_byok — MySQL and MariaDB. See 0036_ai_byok.sql for column semantics.
-- MySQL 8 has no ADD COLUMN IF NOT EXISTS; the migration runner treats
-- "duplicate column" as ignorable on re-run.

ALTER TABLE api_keys ADD COLUMN mcp_user_tools TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE revisions ADD COLUMN via VARCHAR(16) NULL;
ALTER TABLE revisions ADD COLUMN via_client VARCHAR(120) NULL;

CREATE TABLE IF NOT EXISTS ai_provider_credentials (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  site_id       CHAR(36)      NOT NULL,
  user_id       CHAR(36)      NULL,
  scope_key     VARCHAR(48)   NOT NULL,
  provider      VARCHAR(32)   NOT NULL,
  label         VARCHAR(120)  NULL,
  api_key_enc   TEXT          NOT NULL,
  key_last4     VARCHAR(8)    NOT NULL,
  base_url      VARCHAR(500)  NULL,
  organization  VARCHAR(120)  NULL,
  project       VARCHAR(120)  NULL,
  models_json   TEXT          NOT NULL,
  default_model VARCHAR(200)  NULL,
  enabled       TINYINT(1)    NOT NULL DEFAULT 1,
  created_by    CHAR(36)      NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ai_provider_credentials_scope (site_id, scope_key, provider),
  KEY idx_ai_provider_credentials_user (user_id),
  CONSTRAINT fk_ai_provider_credentials_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_provider_credentials_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_usage_daily (
  site_id       CHAR(36)      NOT NULL,
  user_id       CHAR(36)      NOT NULL,
  usage_day     VARCHAR(10)   NOT NULL,
  requests      INT           NOT NULL DEFAULT 0,
  input_tokens  BIGINT        NOT NULL DEFAULT 0,
  output_tokens BIGINT        NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_day),
  CONSTRAINT fk_ai_usage_daily_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_usage_daily_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oauth_clients (
  id                          CHAR(36)      NOT NULL PRIMARY KEY,
  site_id                     CHAR(36)      NOT NULL,
  client_id                   VARCHAR(64)   NOT NULL UNIQUE,
  client_secret_hash          VARCHAR(128)  NULL,
  client_name                 VARCHAR(120)  NOT NULL,
  client_uri                  VARCHAR(500)  NULL,
  redirect_uris_json          TEXT          NOT NULL,
  token_endpoint_auth_method  VARCHAR(32)   NOT NULL DEFAULT 'none',
  created_at                  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at                DATETIME      NULL,
  KEY idx_oauth_clients_site (site_id),
  CONSTRAINT fk_oauth_clients_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oauth_grants (
  id                CHAR(36)      NOT NULL PRIMARY KEY,
  site_id           CHAR(36)      NOT NULL,
  client_id         CHAR(36)      NOT NULL,
  user_id           CHAR(36)      NOT NULL,
  capabilities_json TEXT          NOT NULL,
  mcp_user_tools    TINYINT(1)    NOT NULL DEFAULT 0,
  resource          VARCHAR(500)  NOT NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at      DATETIME      NULL,
  revoked_at        DATETIME      NULL,
  KEY idx_oauth_grants_site (site_id),
  KEY idx_oauth_grants_user (user_id),
  CONSTRAINT fk_oauth_grants_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_oauth_grants_client FOREIGN KEY (client_id) REFERENCES oauth_clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_oauth_grants_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash       VARCHAR(128)  NOT NULL PRIMARY KEY,
  grant_id        CHAR(36)      NOT NULL,
  redirect_uri    VARCHAR(2000) NOT NULL,
  code_challenge  VARCHAR(128)  NOT NULL,
  resource        VARCHAR(500)  NOT NULL,
  expires_at      DATETIME      NOT NULL,
  used_at         DATETIME      NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_oauth_codes_grant FOREIGN KEY (grant_id) REFERENCES oauth_grants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  token_hash  VARCHAR(128)  NOT NULL UNIQUE,
  kind        VARCHAR(16)   NOT NULL,
  grant_id    CHAR(36)      NOT NULL,
  resource    VARCHAR(500)  NOT NULL,
  expires_at  DATETIME      NOT NULL,
  used_at     DATETIME      NULL,
  revoked_at  DATETIME      NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_oauth_tokens_grant (grant_id),
  CONSTRAINT fk_oauth_tokens_grant FOREIGN KEY (grant_id) REFERENCES oauth_grants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
