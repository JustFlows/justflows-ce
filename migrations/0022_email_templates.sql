-- 0022_email_templates — versioned system email design and templates (#63)
CREATE TABLE IF NOT EXISTS email_design_versions (
  id UUID PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL,
  design TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  UNIQUE(site_id, version)
);
CREATE INDEX IF NOT EXISTS idx_email_design_site_status ON email_design_versions(site_id, status);

CREATE TABLE IF NOT EXISTS email_template_versions (
  id UUID PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  template_key VARCHAR(160) NOT NULL,
  owner VARCHAR(160) NOT NULL,
  locale VARCHAR(20) NOT NULL,
  version INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sender_name VARCHAR(120),
  reply_to_policy VARCHAR(20) NOT NULL DEFAULT 'global',
  subject VARCHAR(500) NOT NULL,
  preheader VARCHAR(500) NOT NULL DEFAULT '',
  html_content TEXT NOT NULL,
  text_content TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  UNIQUE(site_id, template_key, locale, version)
);
CREATE INDEX IF NOT EXISTS idx_email_template_lookup ON email_template_versions(site_id, template_key, locale, status);
