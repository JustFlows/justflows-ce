-- Justflows user preferences — MySQL
--
-- Per-user administration preferences — the dashboard welcome/discovery panel
-- state today, and future personal toggles. One JSON row per (user, key).

CREATE TABLE IF NOT EXISTS user_preferences (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  user_id    CHAR(36)     NOT NULL,
  `key`      VARCHAR(255) NOT NULL,
  value      JSON,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_preferences (user_id, `key`),
  KEY idx_user_preferences_user (user_id),
  CONSTRAINT fk_user_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
