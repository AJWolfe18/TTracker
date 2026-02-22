-- Migration 066: SCOTUS Cases Table
-- ADO-87: Database Schema for SCOTUS Tracker
-- Created: 2026-01-19
--
-- This migration creates the SCOTUS case tracking system with:
-- - Main scotus_cases table for case data from CourtListener
-- - Sync state table for pagination tracking
-- - RLS policies with is_public gate (matches pardons pattern)
-- - All required indexes
--
-- DEPENDENCY: Requires set_updated_at() function from migration 001

-- ============================================================================
-- 1. SCOTUS_CASES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.scotus_cases (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- CourtListener identifiers (canonical keys)
  courtlistener_cluster_id BIGINT UNIQUE NOT NULL,
  courtlistener_docket_id BIGINT,

  -- Case metadata (from cluster + docket)
  case_name TEXT NOT NULL,
  case_name_short TEXT,
  case_name_full TEXT,
  docket_number TEXT,           -- Single string, from docket
  term TEXT,                    -- Derived from decided_at year (e.g., "2025")
  decided_at TIMESTAMPTZ,       -- cluster.date_filed (see note below)
  argued_at TIMESTAMPTZ,        -- docket.date_argued (nullable)
  citation TEXT,                -- Best citation from cluster.citations[]

  -- Vote data (NULLABLE - SCDB data is sparse per API verification)
  vote_split TEXT,              -- "6-3" format, may be null
  majority_author TEXT,         -- From majority/plurality/per_curiam opinion
  dissent_authors TEXT[],       -- Aggregated from dissent opinions

  -- Content (from opinion.plain_text)
  syllabus TEXT,                -- Extracted from opinion plain_text (nullable)
  opinion_excerpt TEXT,         -- First ~500 chars if syllabus not found

  -- Classification (populated by enrichment)
  issue_area TEXT,              -- justice_legal, voting_rights, etc.
  petitioner_type TEXT,         -- individual, corporation, government
  respondent_type TEXT,         -- individual, corporation, government

  -- Enrichment fields (from GPT)
  ruling_impact_level SMALLINT CHECK (ruling_impact_level IS NULL OR (ruling_impact_level >= 0 AND ruling_impact_level <= 5)),
  ruling_label TEXT,
  who_wins TEXT,
  who_loses TEXT,
  summary_spicy TEXT,
  why_it_matters TEXT,
  dissent_highlights TEXT,
  evidence_anchors TEXT[],

  -- Publishing gate (matches pardons pattern)
  is_public BOOLEAN NOT NULL DEFAULT false,

  -- Metadata
  enriched_at TIMESTAMPTZ,
  prompt_version TEXT,
  source_url TEXT,              -- Link to CourtListener page
  pdf_url TEXT,                 -- Link to opinion PDF
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 2. SYNC STATE TABLE (for incremental fetching)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.scotus_sync_state (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- Singleton row
  next_url TEXT,                    -- CourtListener `next` URL for pagination
  last_date_filed DATE,             -- Most recent decided_at we've seen
  last_fetch_at TIMESTAMPTZ,
  total_fetched INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert singleton row
INSERT INTO public.scotus_sync_state (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ============================================================================
-- 3. INDEXES (fully qualified with public.)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_scotus_cases_term ON public.scotus_cases(term);
CREATE INDEX IF NOT EXISTS idx_scotus_cases_decided ON public.scotus_cases(decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_scotus_cases_impact ON public.scotus_cases(ruling_impact_level);
CREATE INDEX IF NOT EXISTS idx_scotus_cases_issue ON public.scotus_cases(issue_area);

-- Partial index for unenriched public cases
CREATE INDEX IF NOT EXISTS idx_scotus_cases_unenriched
  ON public.scotus_cases(decided_at DESC)
  WHERE enriched_at IS NULL AND is_public = true;

-- Partial index for public cases (for frontend queries)
CREATE INDEX IF NOT EXISTS idx_scotus_cases_public
  ON public.scotus_cases(decided_at DESC)
  WHERE is_public = true;

-- ============================================================================
-- 4. UPDATED_AT TRIGGER (idempotent - drop first)
-- ============================================================================

DROP TRIGGER IF EXISTS scotus_cases_updated_at ON public.scotus_cases;
CREATE TRIGGER scotus_cases_updated_at
  BEFORE UPDATE ON public.scotus_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS scotus_sync_state_updated_at ON public.scotus_sync_state;
CREATE TRIGGER scotus_sync_state_updated_at
  BEFORE UPDATE ON public.scotus_sync_state
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 5. RLS POLICIES (matches pardons pattern)
-- ============================================================================

ALTER TABLE public.scotus_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scotus_sync_state ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for idempotency
DROP POLICY IF EXISTS "scotus_cases_anon_select" ON public.scotus_cases;
DROP POLICY IF EXISTS "scotus_cases_service_all" ON public.scotus_cases;
DROP POLICY IF EXISTS "scotus_sync_state_service_all" ON public.scotus_sync_state;

-- Anon can only see published cases
CREATE POLICY "scotus_cases_anon_select" ON public.scotus_cases
  FOR SELECT TO anon
  USING (is_public = true);

-- Service role full access (explicit policy in case BYPASSRLS not set)
CREATE POLICY "scotus_cases_service_all" ON public.scotus_cases
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "scotus_sync_state_service_all" ON public.scotus_sync_state
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 6. GRANTS
-- ============================================================================

GRANT SELECT ON public.scotus_cases TO anon;
GRANT ALL ON public.scotus_cases TO service_role;
GRANT ALL ON public.scotus_sync_state TO service_role;

-- Grant sequence usage (IDENTITY columns use sequences)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ============================================================================
-- VERIFICATION QUERIES (run after migration to confirm)
-- ============================================================================
--
-- -- Table exists with correct columns
-- SELECT count(*) FROM scotus_cases;  -- Should return 0
--
-- -- Sync state singleton exists
-- SELECT * FROM scotus_sync_state;  -- Should return 1 row
--
-- -- RLS enabled
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE tablename IN ('scotus_cases', 'scotus_sync_state');
--
-- -- Trigger exists
-- SELECT trigger_name FROM information_schema.triggers
-- WHERE event_object_table = 'scotus_cases';
--
-- -- Indexes
-- SELECT indexname FROM pg_indexes WHERE tablename = 'scotus_cases';
