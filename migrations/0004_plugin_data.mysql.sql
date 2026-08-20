-- Justflows plugin-scoped JSON documents — MySQL
-- Migration: 0004_plugin_data

CREATE TABLE IF NOT EXISTS plugin_data (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  site_id     CHAR(36)     NOT NULL,
  plugin_id   VARCHAR(255) NOT NULL,
  collection  VARCHAR(100) NOT NULL,
  item_id     VARCHAR(255) NOT NULL,
  payload     JSON         NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_plugin_data (site_id, plugin_id, collection, item_id),
  KEY idx_plugin_data_lookup (site_id, plugin_id, collection),
  CONSTRAINT fk_plugin_data_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
