-- Migration 056: Pardons Table
-- ADO-241: Story 1.1 - Database Schema & Migrations
-- Created: 2026-01-12
--
-- This migration creates the pardons tracking system with:
-- - Main pardons table with all fields for person + group pardons
-- - Junction table for pardon-story relationships
-- - Slug generation trigger
-- - RLS policies with is_public gate
-- - All required indexes
--
-- DEPENDENCY: Requires set_updated_at() function from migration 001

-- ============================================================================
-- 1. PARDONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pardons (
  -- Identity
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient_name TEXT NOT NULL,
  recipient_slug TEXT,  -- NOT UNIQUE (collisions handled by id-slug URL pattern)
  nickname TEXT,
  photo_url TEXT,

  -- Group/Mass Pardon Support
  recipient_type TEXT NOT NULL DEFAULT 'person' CHECK (recipient_type IN ('person', 'group')),
  recipient_count INT,
  recipient_criteria TEXT,

  -- Pardon Details
  pardon_date DATE NOT NULL,
  clemency_type TEXT NOT NULL CHECK (clemency_type IN ('pardon', 'commutation', 'pre_emptive')),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'reported')),

  -- DOJ Ingestion Fields (from scraper)
  conviction_district TEXT,  -- e.g., "Southern District of New York"
  case_number TEXT,
  offense_raw TEXT,  -- Raw offense text from DOJ

  -- Crime Info (NULLABLE - populated by enrichment)
  crime_description TEXT,
  crime_category TEXT CHECK (crime_category IS NULL OR crime_category IN (
    'white_collar', 'obstruction', 'political_corruption', 'violent',
    'drug', 'election', 'jan6', 'other'
  )),
  original_sentence TEXT,
  conviction_date DATE,

  -- Classification (NULLABLE - populated by enrichment)
  primary_connection_type TEXT CHECK (primary_connection_type IS NULL OR primary_connection_type IN (
    'mar_a_lago_vip', 'major_donor', 'family', 'political_ally',
    'campaign_staff', 'business_associate', 'jan6_defendant',
    'fake_electors', 'celebrity', 'no_connection'
  )),
  secondary_connection_types TEXT[],
  corruption_level SMALLINT CHECK (corruption_level IS NULL OR corruption_level BETWEEN 1 AND 5),

  -- Research Status (NOT NULL)
  research_status TEXT NOT NULL DEFAULT 'pending' CHECK (research_status IN ('complete', 'in_progress', 'pending')),

  -- Post-Pardon Tracking (NOT NULL)
  post_pardon_status TEXT NOT NULL DEFAULT 'quiet' CHECK (post_pardon_status IN ('quiet', 'under_investigation', 're_offended')),
  post_pardon_notes TEXT,

  -- Research Data
  trump_connection_detail TEXT,
  donation_amount_usd NUMERIC(14,2),

  -- The Receipts (Timeline Data) - NOT NULL to ensure array CHECKs work
  receipts_timeline JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- AI Enrichment
  summary_neutral TEXT,
  summary_spicy TEXT,
  why_it_matters TEXT,
  pattern_analysis TEXT,
  enriched_at TIMESTAMPTZ,
  needs_review BOOLEAN NOT NULL DEFAULT false,

  -- Sources + Dedupe
  primary_source_url TEXT,
  source_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_system TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_system IN ('manual', 'doj_opa')),
  source_key TEXT,  -- DOJ registry ID or URL hash

  -- Publish Gate
  is_public BOOLEAN NOT NULL DEFAULT false,  -- Only true rows visible to anon

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Search
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english',
      COALESCE(recipient_name, '') || ' ' ||
      COALESCE(nickname, '') || ' ' ||
      COALESCE(crime_description, '') || ' ' ||
      COALESCE(trump_connection_detail, '') || ' ' ||
      COALESCE(summary_neutral, '')
    )
  ) STORED,

  -- Constraints
  CONSTRAINT pardons_group_fields_chk CHECK (
    (recipient_type = 'person'
        AND recipient_count IS NULL
        AND (recipient_criteria IS NULL OR length(trim(recipient_criteria)) = 0))
    OR (recipient_type = 'group'
        AND recipient_count IS NOT NULL AND recipient_count > 0
        AND recipient_criteria IS NOT NULL AND length(trim(recipient_criteria)) > 0)
  ),
  CONSTRAINT pardons_donation_nonnegative CHECK (
    donation_amount_usd IS NULL OR donation_amount_usd >= 0
  ),
  CONSTRAINT pardons_receipts_timeline_is_array CHECK (
    jsonb_typeof(receipts_timeline) = 'array'
  ),
  CONSTRAINT pardons_source_urls_is_array CHECK (
    jsonb_typeof(source_urls) = 'array'
  )
);

-- Partial unique index for DOJ dedupe (only when source_key is set)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pardons_source_key
  ON public.pardons (source_system, source_key)
  WHERE source_key IS NOT NULL;

-- ============================================================================
-- 2. PARDON_STORY JUNCTION TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pardon_story (
  pardon_id BIGINT REFERENCES public.pardons(id) ON DELETE CASCADE,
  story_id BIGINT REFERENCES public.stories(id) ON DELETE CASCADE,
  link_type TEXT DEFAULT 'related' CHECK (link_type IN ('primary_coverage', 'background', 'related', 'mentioned')),
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (pardon_id, story_id)
);

-- Index for reverse lookups (finding pardons linked to a story)
CREATE INDEX IF NOT EXISTS idx_pardon_story_story_id ON public.pardon_story(story_id);

-- ============================================================================
-- 3. INDEXES
-- ============================================================================

-- TSVECTOR GIN for full-text search
CREATE INDEX IF NOT EXISTS idx_pardons_search ON public.pardons USING GIN(search_vector);

-- Composite index for cursor pagination (pardon_date, id)
CREATE INDEX IF NOT EXISTS idx_pardons_pardon_date_id_desc ON public.pardons(pardon_date DESC, id DESC);

-- btree indexes for filters
CREATE INDEX IF NOT EXISTS idx_pardons_connection_type ON public.pardons(primary_connection_type);
CREATE INDEX IF NOT EXISTS idx_pardons_crime_category ON public.pardons(crime_category);
CREATE INDEX IF NOT EXISTS idx_pardons_corruption_level ON public.pardons(corruption_level);
CREATE INDEX IF NOT EXISTS idx_pardons_recipient_type ON public.pardons(recipient_type);
CREATE INDEX IF NOT EXISTS idx_pardons_research_status ON public.pardons(research_status);
CREATE INDEX IF NOT EXISTS idx_pardons_post_pardon_status ON public.pardons(post_pardon_status);

-- Publish gate partial index (for anon queries - optimized for public browsing)
-- This combines the is_public filter with the pagination columns
CREATE INDEX IF NOT EXISTS idx_pardons_public_pardon_date_id_desc
  ON public.pardons (pardon_date DESC, id DESC)
  WHERE is_public = true;

-- ============================================================================
-- 4. TRIGGERS
-- ============================================================================

-- Slug generation trigger function
CREATE OR REPLACE FUNCTION public.pardons_set_recipient_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.recipient_slug := lower(regexp_replace(
    regexp_replace(NEW.recipient_name, '[^a-zA-Z0-9\s-]', '', 'g'),
    '\s+', '-', 'g'
  ));
  RETURN NEW;
END;
$$;

-- Trigger for slug on INSERT (fires on NULL or empty string)
DROP TRIGGER IF EXISTS trg_pardons_generate_slug ON public.pardons;
CREATE TRIGGER trg_pardons_generate_slug
  BEFORE INSERT ON public.pardons
  FOR EACH ROW
  WHEN (NEW.recipient_slug IS NULL OR length(trim(NEW.recipient_slug)) = 0)
  EXECUTE FUNCTION public.pardons_set_recipient_slug();

-- Updated_at trigger (reuses existing function from 001_rss_system_PRODUCTION_READY.sql)
DROP TRIGGER IF EXISTS trg_pardons_set_updated_at ON public.pardons;
CREATE TRIGGER trg_pardons_set_updated_at
  BEFORE UPDATE ON public.pardons
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 5. RLS POLICIES
-- ============================================================================

-- Enable RLS
ALTER TABLE public.pardons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pardon_story ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "pardons_anon_select" ON public.pardons;
DROP POLICY IF EXISTS "pardon_story_anon_select" ON public.pardon_story;

-- Anon can only see published pardons (hides incomplete auto-ingested rows)
CREATE POLICY "pardons_anon_select" ON public.pardons
  FOR SELECT TO anon
  USING (is_public = true);

-- Junction table: only show links to published pardons
CREATE POLICY "pardon_story_anon_select" ON public.pardon_story
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.pardons p WHERE p.id = pardon_id AND p.is_public = true
  ));

-- NO authenticated policies - service role reads unpublished, no future user data leak
-- NO write policies for anon = admin-only writes via service role

-- ============================================================================
-- 6. GRANTS
-- ============================================================================

-- Grant select to anon (RLS policies control visibility)
GRANT SELECT ON public.pardons TO anon;
GRANT SELECT ON public.pardon_story TO anon;

-- Service role has full access (bypasses RLS)
GRANT ALL ON public.pardons TO service_role;
GRANT ALL ON public.pardon_story TO service_role;

-- ============================================================================
-- VERIFICATION QUERIES (run after migration to confirm)
-- ============================================================================
--
-- -- Verify table exists with correct columns
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'pardons'
-- ORDER BY ordinal_position;
--
-- -- Verify indexes
-- SELECT indexname FROM pg_indexes WHERE tablename = 'pardons';
--
-- -- Verify RLS enabled
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE tablename IN ('pardons', 'pardon_story');
--
-- -- Verify constraints
-- SELECT conname, contype FROM pg_constraint
-- WHERE conrelid = 'public.pardons'::regclass;
