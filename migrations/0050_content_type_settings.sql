/** Per-type settings; NULL preserves the existing site defaults. */
ALTER TABLE content_types ADD COLUMN settings JSONB NULL;
