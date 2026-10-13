-- MariaDB uses this migration too.
ALTER TABLE tenants ADD COLUMN deletion_requested_at DATETIME NULL;
UPDATE tenants SET deletion_requested_at = updated_at WHERE status IN ('suspended', 'deleted') AND slug <> 'primary';
