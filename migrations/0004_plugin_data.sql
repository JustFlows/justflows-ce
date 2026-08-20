-- Justflows plugin-scoped JSON documents
-- Migration: 0004_plugin_data

BEGIN;

CREATE TABLE plugin_data (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  plugin_id   VARCHAR(255) NOT NULL,
  collection  VARCHAR(100) NOT NULL,
  item_id     VARCHAR(255) NOT NULL,
  payload     JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, plugin_id, collection, item_id)
);

CREATE INDEX idx_plugin_data_lookup ON plugin_data (site_id, plugin_id, collection);

COMMIT;
