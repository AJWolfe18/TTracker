-- Migration 023: Executive Orders Enrichment Schema
-- Purpose: Add 4-part editorial analysis, action framework, and telemetry tables
-- Related: TTRC-216 (Executive Orders Enrichment - Database Schema)
-- Epic: TTRC-16 (Executive Orders Tracker)
-- Date: 2025-10-12

-- ============================================================================
-- 1. CREATE EO_CATEGORY ENUM (10 EO-specific categories)
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE eo_category AS ENUM (
    'immigration_border',
    'environment_energy',
    'health_care',
    'education',
    'justice_civil_rights_voting',
    'natsec_foreign',
    'economy_jobs_taxes',
    'technology_data_privacy',
    'infra_housing_transport',
    'gov_ops_workforce'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 2. ADD ENRICHMENT FIELDS TO EXECUTIVE_ORDERS TABLE
-- ============================================================================

-- 4-Part Editorial Analysis (NOT NULL with defaults for backward compatibility)
ALTER TABLE executive_orders
  ADD COLUMN IF NOT EXISTS section_what_they_say TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS section_what_it_means TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS section_reality_check TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS section_why_it_matters TEXT NOT NULL DEFAULT '';

-- Enhanced Metadata Arrays (explicit empty array defaults)
ALTER TABLE executive_orders
  ADD COLUMN IF NOT EXISTS regions TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS policy_areas TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS affected_agencies TEXT[] NOT NULL DEFAULT ARRAY[]::text[];

-- Action Framework Fields
ALTER TABLE executive_orders
  ADD COLUMN IF NOT EXISTS action_tier TEXT CHECK (action_tier IN ('direct','systemic','tracking')),
  ADD COLUMN IF NOT EXISTS action_confidence SMALLINT CHECK (action_confidence BETWEEN 0 AND 10),
  ADD COLUMN IF NOT EXISTS action_reasoning TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS action_section JSONB DEFAULT NULL;

-- Enforce consistency: direct/systemic must have action_section, tracking must be NULL
ALTER TABLE executive_orders
  ADD CONSTRAINT eo_action_tier_chk
  CHECK (
    action_tier IS NULL
    OR (
      (action_tier IN ('direct','systemic') AND action_section IS NOT NULL)
      OR (action_tier = 'tracking' AND action_section IS NULL)
    )
  ) NOT VALID;

-- Tracking Fields
ALTER TABLE executive_orders
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prompt_version TEXT DEFAULT 'v1';

-- ============================================================================
-- 3. CREATE SUPPORT TABLES
-- ============================================================================

-- Dead-letter queue for failed enrichments
-- Note: eo_id type will be auto-coerced to match executive_orders.id below
CREATE TABLE IF NOT EXISTS eo_enrichment_errors (
  id BIGSERIAL PRIMARY KEY,
  eo_id TEXT,  -- Nullable for ON DELETE SET NULL, type coerced below
  error_code TEXT,
  message TEXT,
  attempt_count INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cost tracking and telemetry
-- Note: eo_id type will be auto-coerced to match executive_orders.id below
CREATE TABLE IF NOT EXISTS eo_enrichment_costs (
  id BIGSERIAL PRIMARY KEY,
  eo_id TEXT,  -- Nullable for ON DELETE SET NULL, type coerced below
  input_tokens INT,
  output_tokens INT,
  usd_estimate NUMERIC(10,6),
  model TEXT,
  prompt_version TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 3a. AUTO-COERCE eo_id TYPE TO MATCH executive_orders.id
-- ============================================================================
-- This detects whether executive_orders.id is integer, uuid, or text
-- and converts eo_id columns accordingly before adding foreign keys

DO $$
DECLARE
  id_typ text;
BEGIN
  SELECT data_type
  INTO id_typ
  FROM information_schema.columns
  WHERE table_name = 'executive_orders' AND column_name = 'id'
  LIMIT 1;

  -- Normalize to canonical names and convert columns
  IF id_typ IN ('integer', 'bigint', 'smallint') THEN
    -- Convert eo_id TEXT -> INTEGER (safe cast if tables are empty)
    EXECUTE 'ALTER TABLE eo_enrichment_errors ALTER COLUMN eo_id TYPE integer USING NULLIF(trim(eo_id), '''')::integer';
    EXECUTE 'ALTER TABLE eo_enrichment_costs ALTER COLUMN eo_id TYPE integer USING NULLIF(trim(eo_id), '''')::integer';

  ELSIF id_typ = 'uuid' THEN
    EXECUTE 'ALTER TABLE eo_enrichment_errors ALTER COLUMN eo_id TYPE uuid USING NULLIF(trim(eo_id), '''')::uuid';
    EXECUTE 'ALTER TABLE eo_enrichment_costs ALTER COLUMN eo_id TYPE uuid USING NULLIF(trim(eo_id), '''')::uuid';

  ELSIF id_typ IN ('text', 'character varying', 'character') THEN
    -- No change needed, columns are already text
    -- Keep as-is
  ELSE
    RAISE EXCEPTION 'Unsupported executive_orders.id type: %', id_typ;
  END IF;
END$$;

-- ============================================================================
-- 3b. FOREIGN KEYS + INDEXES FOR TELEMETRY TABLES
-- ============================================================================

-- Drop existing FKs if migration partially applied
ALTER TABLE IF EXISTS eo_enrichment_errors DROP CONSTRAINT IF EXISTS eo_enrichment_errors_eo_fk;
ALTER TABLE IF EXISTS eo_enrichment_costs DROP CONSTRAINT IF EXISTS eo_enrichment_costs_eo_fk;

-- Create FKs with SET NULL (now types match)
ALTER TABLE eo_enrichment_errors
  ADD CONSTRAINT eo_enrichment_errors_eo_fk
  FOREIGN KEY (eo_id) REFERENCES executive_orders(id)
  ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE eo_enrichment_costs
  ADD CONSTRAINT eo_enrichment_costs_eo_fk
  FOREIGN KEY (eo_id) REFERENCES executive_orders(id)
  ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_eo_costs_date ON eo_enrichment_costs(created_at);
CREATE INDEX IF NOT EXISTS idx_eo_costs_eo_date ON eo_enrichment_costs(eo_id, created_at);
CREATE INDEX IF NOT EXISTS idx_eo_errors_eo_id ON eo_enrichment_errors(eo_id);

-- Grants for new tables & sequences
GRANT SELECT, INSERT ON eo_enrichment_errors TO service_role, authenticated;
GRANT SELECT, INSERT ON eo_enrichment_costs TO service_role, authenticated;

DO $$
DECLARE
  seq text;
BEGIN
  FOR seq IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_sequence s ON s.seqrelid = c.oid
    WHERE c.relname IN ('eo_enrichment_errors_id_seq','eo_enrichment_costs_id_seq')
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I TO service_role, authenticated;', seq);
  END LOOP;
END$$;

-- ============================================================================
-- 4. MIGRATE LEGACY CATEGORIES TO NEW ENUM
-- ============================================================================

-- Add new column for enum category
ALTER TABLE executive_orders ADD COLUMN IF NOT EXISTS category_v2 eo_category;

-- Backfill using mapping (old string → new enum)
UPDATE executive_orders SET category_v2 =
  CASE category
    WHEN 'immigration' THEN 'immigration_border'::eo_category
    WHEN 'environment' THEN 'environment_energy'::eo_category
    WHEN 'healthcare' THEN 'health_care'::eo_category
    WHEN 'defense' THEN 'natsec_foreign'::eo_category
    WHEN 'trade' THEN 'economy_jobs_taxes'::eo_category
    WHEN 'education' THEN 'education'::eo_category
    WHEN 'judicial' THEN 'justice_civil_rights_voting'::eo_category
    WHEN 'economic' THEN 'economy_jobs_taxes'::eo_category
    WHEN 'regulatory' THEN 'gov_ops_workforce'::eo_category
    WHEN 'government_operations' THEN 'gov_ops_workforce'::eo_category
    ELSE 'gov_ops_workforce'::eo_category
  END
WHERE category_v2 IS NULL;

-- Make required and swap columns
ALTER TABLE executive_orders ALTER COLUMN category_v2 SET NOT NULL;

-- Drop view dependencies before dropping column
DROP VIEW IF EXISTS recent_executive_orders CASCADE;

-- Swap columns
ALTER TABLE executive_orders DROP COLUMN IF EXISTS category;
ALTER TABLE executive_orders RENAME COLUMN category_v2 TO category;

-- Recreate view with new enum category column
CREATE OR REPLACE VIEW recent_executive_orders AS
SELECT *
FROM executive_orders
ORDER BY date DESC
LIMIT 100;

-- Day-one indexes for filtering and searching
CREATE INDEX IF NOT EXISTS idx_eo_category ON executive_orders(category);
CREATE INDEX IF NOT EXISTS idx_eo_enriched_at ON executive_orders(enriched_at) WHERE enriched_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_eo_prompt_version ON executive_orders(prompt_version);

-- GIN indexes for array columns (filtering by regions, policy areas, agencies)
CREATE INDEX IF NOT EXISTS idx_eo_regions_gin ON executive_orders USING GIN (regions);
CREATE INDEX IF NOT EXISTS idx_eo_policy_areas_gin ON executive_orders USING GIN (policy_areas);
CREATE INDEX IF NOT EXISTS idx_eo_agencies_gin ON executive_orders USING GIN (affected_agencies);

-- ============================================================================
-- 5. WRITE-ONCE TRIGGER (hardened - prevents version decreases)
-- ============================================================================
CREATE OR REPLACE FUNCTION prevent_enriched_at_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Disallow decreasing prompt_version ever
  IF NEW.prompt_version < OLD.prompt_version THEN
    RAISE EXCEPTION 'prompt_version cannot decrease (% -> %)', OLD.prompt_version, NEW.prompt_version;
  END IF;

  -- If enriched_at is changing after first set, require prompt_version to increase
  IF OLD.enriched_at IS NOT NULL
     AND NEW.enriched_at IS DISTINCT FROM OLD.enriched_at
     AND NOT (NEW.prompt_version > OLD.prompt_version)
  THEN
    RAISE EXCEPTION 'enriched_at cannot be updated without increasing prompt_version';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lock_enriched_at
  BEFORE UPDATE ON executive_orders
  FOR EACH ROW
  EXECUTE FUNCTION prevent_enriched_at_update();

-- ============================================================================
-- 6. VERIFICATION QUERIES
-- ============================================================================

-- Check enum created
SELECT
  'eo_category enum' as check_item,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'eo_category'
  ) THEN '✅ Created' ELSE '❌ Missing' END as status;

-- Check new columns exist
SELECT
  'enrichment fields' as check_item,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'executive_orders'
    AND column_name IN ('section_what_they_say', 'enriched_at', 'action_section')
  ) THEN '✅ Added' ELSE '❌ Missing' END as status;

-- Check support tables created
SELECT
  'support tables' as check_item,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name IN ('eo_enrichment_errors', 'eo_enrichment_costs')
  ) THEN '✅ Created' ELSE '❌ Missing' END as status;

-- Check trigger created
SELECT
  'write-once trigger' as check_item,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'lock_enriched_at'
  ) THEN '✅ Created' ELSE '❌ Missing' END as status;

-- Check FK type matching
SELECT
  'eo_id types match' as check_item,
  CASE WHEN (
    SELECT data_type FROM information_schema.columns WHERE table_name='executive_orders' AND column_name='id'
  ) = (
    SELECT data_type FROM information_schema.columns WHERE table_name='eo_enrichment_costs' AND column_name='eo_id'
  ) THEN '✅ Types match' ELSE '❌ Type mismatch' END as status;

-- Sample record count
SELECT
  COUNT(*) as total_eos,
  COUNT(CASE WHEN enriched_at IS NOT NULL THEN 1 END) as enriched_count,
  COUNT(CASE WHEN enriched_at IS NULL THEN 1 END) as unenriched_count
FROM executive_orders;

-- Category distribution
SELECT
  category,
  COUNT(*) as count
FROM executive_orders
GROUP BY category
ORDER BY count DESC;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
SELECT '✅ Migration 023 complete - Executive Orders enrichment schema ready' as status;

-- ============================================================================
-- POST-BACKFILL VALIDATION (run after TTRC-219 completes)
-- ============================================================================
-- After enrichment backfill is complete, validate the action_tier constraint:
-- ALTER TABLE executive_orders VALIDATE CONSTRAINT eo_action_tier_chk;
--
-- This enforces data quality going forward and catches any constraint violations
-- from the backfill process.
