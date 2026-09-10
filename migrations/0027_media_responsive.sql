-- 0027_media_responsive
-- Responsive image derivatives, focal point, and source format for the media
-- library (#103). The `derivatives` column (JSONB, shipped in 0012_baseline)
-- now carries the generated variant set: width-scaled WebP/AVIF plus a fallback
-- format, and a focal-point thumbnail. These columns add the art-direction
-- focal point (0..1 on each axis), the detected source format, and the time the
-- variant set was last (re)built by the Tools regeneration job.
ALTER TABLE media ADD COLUMN IF NOT EXISTS focal_x DOUBLE PRECISION;
ALTER TABLE media ADD COLUMN IF NOT EXISTS focal_y DOUBLE PRECISION;
ALTER TABLE media ADD COLUMN IF NOT EXISTS original_format VARCHAR(16);
ALTER TABLE media ADD COLUMN IF NOT EXISTS variants_generated_at TIMESTAMPTZ;

-- Public rendering looks media rows up by their public `url` to attach srcset;
-- keep that lookup indexed alongside the existing site scope.
CREATE INDEX IF NOT EXISTS idx_media_site_url ON media(site_id, url);
