-- Private files: files a plugin stores for one site that are never public
-- (for example products bought as downloads). The bytes live in the private
-- storage the site resolves to (its own connection, the platform's, the
-- environment's S3 bucket, or local disk); this table records each file so
-- usage limits can count it and a storage change can copy it.

CREATE TABLE IF NOT EXISTS private_files (
  id            UUID         PRIMARY KEY,
  site_id       UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  owner         VARCHAR(80)  NOT NULL,
  file_key      VARCHAR(512) NOT NULL,
  size_bytes    BIGINT       NOT NULL,
  content_type  VARCHAR(255) NOT NULL,
  sha256        CHAR(64)     NOT NULL,
  storage_id    VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_private_files_key ON private_files(site_id, owner, file_key);
CREATE INDEX IF NOT EXISTS idx_private_files_storage ON private_files(site_id, storage_id);
