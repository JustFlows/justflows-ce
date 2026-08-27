-- Remap the seeded language-only English tag to en-US.
-- Migration: 0011_default_locale_en_us

UPDATE content c
LEFT JOIN content o
  ON o.site_id = c.site_id AND o.type = c.type AND o.slug = c.slug AND o.locale = 'en-US'
SET c.locale = 'en-US'
WHERE c.locale = 'en' AND o.id IS NULL;

UPDATE revisions SET locale = 'en-US' WHERE locale = 'en';

UPDATE languages l
LEFT JOIN languages x
  ON x.site_id = l.site_id AND x.code = 'en-US'
SET l.code = 'en-US'
WHERE l.code = 'en' AND x.id IS NULL;

DELETE l FROM languages l
INNER JOIN languages keep ON keep.site_id = l.site_id AND keep.code = 'en-US'
LEFT JOIN content c ON c.site_id = l.site_id AND c.locale = 'en'
WHERE l.code = 'en' AND c.id IS NULL;

ALTER TABLE content MODIFY locale VARCHAR(20) NOT NULL DEFAULT 'en-US';
