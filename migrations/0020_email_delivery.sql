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
