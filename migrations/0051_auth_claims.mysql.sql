-- The last accepted authenticator step. A later sign-in may only claim a newer step.
ALTER TABLE users ADD COLUMN totp_last_step BIGINT NULL;
