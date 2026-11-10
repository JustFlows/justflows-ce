CREATE TABLE IF NOT EXISTS mcp_hub_sites (
  origin VARCHAR(300) PRIMARY KEY,
  client_id VARCHAR(255) NOT NULL,
  authorization_endpoint VARCHAR(2048) NOT NULL,
  token_endpoint VARCHAR(2048) NOT NULL,
  revocation_endpoint VARCHAR(2048),
  resource VARCHAR(2048) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
