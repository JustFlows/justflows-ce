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
