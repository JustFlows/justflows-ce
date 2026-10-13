-- Keep the retention clock independent of workspace edits. Reactivation clears it.
ALTER TABLE tenants ADD COLUMN deletion_requested_at TIMESTAMPTZ;
UPDATE tenants SET deletion_requested_at = updated_at WHERE status IN ('suspended', 'deleted') AND slug <> 'primary';
