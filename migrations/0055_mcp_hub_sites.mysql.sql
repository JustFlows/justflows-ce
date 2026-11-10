CREATE TABLE IF NOT EXISTS mcp_hub_sites (
  origin VARCHAR(300) PRIMARY KEY,
  client_id VARCHAR(255) NOT NULL,
  authorization_endpoint VARCHAR(2048) NOT NULL,
  token_endpoint VARCHAR(2048) NOT NULL,
  revocation_endpoint VARCHAR(2048),
  resource VARCHAR(2048) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
