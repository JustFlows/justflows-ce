
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
  blocks       JSON          NOT NULL,
  fields       JSON          NOT NULL DEFAULT (JSON_OBJECT()),
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
  value      JSON,
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
  manifest             JSON         NOT NULL,
  approved_permissions JSON         NOT NULL,
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
  css_variables JSON         NOT NULL DEFAULT (JSON_OBJECT()),
  manifest      JSON         NOT NULL DEFAULT (JSON_OBJECT()),
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
  derivatives  JSON         NOT NULL DEFAULT (JSON_OBJECT()),
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
  blocks       JSON          NOT NULL,
  fields       JSON          NOT NULL DEFAULT (JSON_OBJECT()),
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
  items    JSON         NOT NULL,
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
  payload      JSON         NOT NULL,
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
  metadata   JSON         NOT NULL,
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

-- Justflows multilingual support — MySQL / MariaDB

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

-- Justflows CSS providers — MySQL / MariaDB

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

-- Justflows plugin-scoped JSON documents — MySQL

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

-- Justflows persisted content type definitions — MySQL

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

-- Justflows session revocation counter — mysql
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

-- Justflows two-factor authentication (TOTP) — mysql
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

-- Justflows administrative audit log — mysql
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

-- Justflows working content revisions — MySQL
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

-- Justflows template parts — MySQL

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

