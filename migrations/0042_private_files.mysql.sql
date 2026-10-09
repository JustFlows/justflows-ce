-- Private files: files a plugin stores for one site that are never public
-- (for example products bought as downloads). The bytes live in the private
-- storage the site resolves to (its own connection, the platform's, the
-- environment's S3 bucket, or local disk); this table records each file so
-- usage limits can count it and a storage change can copy it.
-- MySQL 8+ and MariaDB 10.6+ share this file.

CREATE TABLE IF NOT EXISTS private_files (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  site_id       CHAR(36)     NOT NULL,
  owner         VARCHAR(80)  NOT NULL,
  file_key      VARCHAR(512) NOT NULL,
  size_bytes    BIGINT       NOT NULL,
  content_type  VARCHAR(255) NOT NULL,
  sha256        CHAR(64)     NOT NULL,
  storage_id    VARCHAR(255) NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_private_files_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  UNIQUE KEY uq_private_files_key (site_id, owner, file_key(255)),
  KEY idx_private_files_storage (site_id, storage_id(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
