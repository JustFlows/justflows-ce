-- Distinguish admin-curated spam-signal terms from ones the "mark as spam"
-- feedback loop trained automatically, so training never overwrites an
-- admin's manual entry and the admin UI can show provenance.
ALTER TABLE comment_spam_terms ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'trained';
