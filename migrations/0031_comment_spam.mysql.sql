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
