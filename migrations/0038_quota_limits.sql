-- Workspace and site quotas. A missing row means unlimited.

CREATE TABLE IF NOT EXISTS quota_limits (
  scope       VARCHAR(20) NOT NULL,
  scope_id    UUID NOT NULL,
  meter_key   VARCHAR(120) NOT NULL,
  limit_value BIGINT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, scope_id, meter_key),
  CONSTRAINT quota_limits_scope_check CHECK (scope IN ('workspace', 'site')),
  CONSTRAINT quota_limits_value_check CHECK (limit_value >= 0)
);
