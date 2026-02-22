-- Migration 071: Add enrichment provenance to pardons (ADO-276)
-- Aligns pardons with stories/executive_orders enrichment_meta pattern

-- Add enrichment_meta JSONB for provenance tracking
-- Fields: { prompt_version, frame, style_pattern_id, pool, collision, model, seed, enriched_at, frame_reason, pool_reason }
ALTER TABLE pardons
  ADD COLUMN IF NOT EXISTS enrichment_meta JSONB;

COMMENT ON COLUMN pardons.enrichment_meta IS
'Enrichment provenance: { prompt_version, frame, style_pattern_id, pool, collision, model, enriched_at }';

-- Add prompt_version as top-level column for easier querying
-- (Also stored in enrichment_meta, but this avoids JSON queries for common filters)
ALTER TABLE pardons
  ADD COLUMN IF NOT EXISTS prompt_version TEXT;

COMMENT ON COLUMN pardons.prompt_version IS
'Enrichment prompt version (e.g., v1-ado276). Matches enrichment_meta.prompt_version.';

-- Verification query (run after migration)
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'pardons' AND column_name IN ('enrichment_meta', 'prompt_version');
