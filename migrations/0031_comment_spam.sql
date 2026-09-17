-- Comment spam filtering and submission throttling (#109).
ALTER TABLE comments ADD COLUMN IF NOT EXISTS spam_score REAL;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS spam_reasons TEXT;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS held_reason VARCHAR(40);

CREATE TABLE IF NOT EXISTS comment_moderation_rules (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  list         VARCHAR(10)   NOT NULL,
  field        VARCHAR(20)   NOT NULL,
  pattern      VARCHAR(500)  NOT NULL,
  note         VARCHAR(500),
  created_by   UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  hit_count    INT           NOT NULL DEFAULT 0,
  last_hit_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_comment_rules_site ON comment_moderation_rules(site_id, list, field);

CREATE TABLE IF NOT EXISTS comment_spam_terms (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind       VARCHAR(10)  NOT NULL,
  value      VARCHAR(255) NOT NULL,
  weight     REAL         NOT NULL DEFAULT 1,
  hits       INT          NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, kind, value)
);
CREATE INDEX IF NOT EXISTS idx_comment_spam_terms_site ON comment_spam_terms(site_id, kind, value);
