/** A translation shares the creation date and publish date of its translation group. */
UPDATE content AS c
SET created_at = g.created_at
FROM (
  SELECT site_id, COALESCE(translation_group_id, id) AS group_id, MIN(created_at) AS created_at
  FROM content
  GROUP BY site_id, COALESCE(translation_group_id, id)
) AS g
WHERE c.site_id = g.site_id
  AND COALESCE(c.translation_group_id, c.id) = g.group_id
  AND c.created_at > g.created_at;

UPDATE content AS c
SET published_at = g.published_at
FROM (
  SELECT site_id, COALESCE(translation_group_id, id) AS group_id, MIN(published_at) AS published_at
  FROM content
  WHERE published_at IS NOT NULL
  GROUP BY site_id, COALESCE(translation_group_id, id)
) AS g
WHERE c.site_id = g.site_id
  AND COALESCE(c.translation_group_id, c.id) = g.group_id
  AND c.published_at IS NOT NULL
  AND c.published_at > g.published_at;
