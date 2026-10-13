-- Content types each taxonomy applies to: a JSON array of content type slugs.
-- NULL reads as no content types. InnoDB already indexes content_terms.term_id for its foreign key.
ALTER TABLE taxonomies ADD COLUMN content_types JSON NULL;
