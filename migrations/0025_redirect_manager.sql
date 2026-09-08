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
