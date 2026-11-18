/**
 * Data requests members make themselves from their account (GDPR Art. 17).
 * A member asks for erasure on their "Your data" page; an administrator
 * reviews it under Users → Data requests and carries it out, which erases
 * the member's data in core and every plugin and deletes the account.
 *
 * `email` is kept only while the request is open, so the member can be told
 * the outcome; once it is handled only `address_ref`, a hash, remains.
 * `user_id` has no foreign key: the account is deleted when a request is
 * completed, and the record of the request outlives it.
 */
CREATE TABLE IF NOT EXISTS data_requests (
  id           UUID         PRIMARY KEY,
  site_id      UUID         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind         VARCHAR(16)  NOT NULL,
  user_id      UUID,
  email        VARCHAR(320) NOT NULL DEFAULT '',
  address_ref  VARCHAR(32)  NOT NULL,
  status       VARCHAR(16)  NOT NULL,
  note         TEXT,
  outcome      TEXT,
  requested_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  due_at       TIMESTAMPTZ  NOT NULL,
  handled_at   TIMESTAMPTZ,
  handled_by   UUID
);

CREATE INDEX IF NOT EXISTS idx_data_requests_site ON data_requests(site_id, status, requested_at);
CREATE INDEX IF NOT EXISTS idx_data_requests_user ON data_requests(site_id, user_id);
