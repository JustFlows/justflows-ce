-- Remap the seeded language-only English tag to en-US.
-- Migration: 0011_default_locale_en_us

BEGIN;

UPDATE content c
SET locale = 'en-US'
WHERE c.locale = 'en'
  AND NOT EXISTS (
    SELECT 1 FROM content o
    WHERE o.site_id = c.site_id
      AND o.type = c.type
      AND o.slug = c.slug
      AND o.locale = 'en-US'
  );

UPDATE revisions SET locale = 'en-US' WHERE locale = 'en';

UPDATE languages l
SET code = 'en-US'
WHERE l.code = 'en'
  AND NOT EXISTS (
    SELECT 1 FROM languages x
    WHERE x.site_id = l.site_id AND x.code = 'en-US'
  );

DELETE FROM languages l
WHERE l.code = 'en'
  AND EXISTS (
    SELECT 1 FROM languages x
    WHERE x.site_id = l.site_id AND x.code = 'en-US'
  )
  AND NOT EXISTS (
    SELECT 1 FROM content c
    WHERE c.site_id = l.site_id AND c.locale = 'en'
  );

ALTER TABLE content ALTER COLUMN locale SET DEFAULT 'en-US';

COMMIT;
