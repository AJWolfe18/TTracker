-- Migration 070: Add enrichment_meta JSONB for provenance tracking
-- ADO-274 PROD blocker: Cannot deploy variation system without provenance
--
-- Purpose: Track enrichment metadata for debugging and auditing
-- Fields stored: { prompt_version, frame, style_pattern_id, collision, model, enriched_at }
--
-- Why JSONB over separate columns:
-- 1. Schema flexibility - can add fields without migrations
-- 2. Avoids repeated ALTER TABLE for each new diagnostic field
-- 3. Can add GIN index later if querying specific fields

-- Add to stories table (ADO-274)
ALTER TABLE stories
ADD COLUMN IF NOT EXISTS enrichment_meta JSONB;

COMMENT ON COLUMN stories.enrichment_meta IS
'Enrichment provenance: { prompt_version, frame, style_pattern_id, collision, model, enriched_at }';

-- Add to executive_orders table (ADO-273 - for consistency per feedback)
ALTER TABLE executive_orders
ADD COLUMN IF NOT EXISTS enrichment_meta JSONB;

COMMENT ON COLUMN executive_orders.enrichment_meta IS
'Enrichment provenance: { prompt_version, frame, style_pattern_id, collision, model, enriched_at }';

-- Verification query (run after migration)
-- SELECT
--   'stories' as table_name,
--   column_name,
--   data_type
-- FROM information_schema.columns
-- WHERE table_name = 'stories' AND column_name = 'enrichment_meta'
-- UNION ALL
-- SELECT
--   'executive_orders',
--   column_name,
--   data_type
-- FROM information_schema.columns
-- WHERE table_name = 'executive_orders' AND column_name = 'enrichment_meta';
