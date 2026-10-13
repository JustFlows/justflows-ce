-- Content types each taxonomy applies to: a JSON array of content type slugs.
ALTER TABLE taxonomies ADD COLUMN content_types JSONB NOT NULL DEFAULT '[]';
-- Term counts and archives look content up by term.
CREATE INDEX IF NOT EXISTS idx_content_terms_term ON content_terms (term_id);
