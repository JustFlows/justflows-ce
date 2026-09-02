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
