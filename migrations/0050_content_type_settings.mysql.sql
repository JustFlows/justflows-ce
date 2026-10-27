/** MariaDB uses the same JSON representation as MySQL. */
ALTER TABLE content_types ADD COLUMN settings JSON NULL;
