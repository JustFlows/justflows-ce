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
