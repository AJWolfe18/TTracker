-- ============================================================================
-- SEED: Compliance Rules for Existing Feeds (FIXED for TEST)
-- ============================================================================
-- Purpose: Configure content extraction limits for each RSS feed
-- Author: Josh (PM) + Claude
-- Date: October 28, 2025
-- Environment: TEST
-- Prerequisites: Migration 027 completed
-- Expected Duration: 1 second
-- Fix: Removed Feed ID 6 (deleted in TTRC-242)

-- ============================================================================
-- BACKGROUND: Why Compliance Rules?
-- ============================================================================
-- 
-- Most news organizations' Terms of Service allow:
-- - RSS feed consumption for personal/non-commercial use
-- - Brief excerpts (typically 150-300 words)
-- - Attribution and link-back to original article
--
-- They typically prohibit:
-- - Full article republication without license
-- - Removing attribution
-- - Commercial redistribution
--
-- TrumpyTracker stores excerpts only (1200 chars ≈ 200-250 words) to comply.
--
-- ============================================================================

-- ============================================================================
-- INSERT COMPLIANCE RULES
-- ============================================================================

INSERT INTO public.feed_compliance_rules (
  feed_id, 
  source_name, 
  allow_full_text, 
  max_chars, 
  notes
)
VALUES 
  -- Reuters Politics
  (1, 'Reuters Politics', FALSE, 1200, 
   'Excerpt only per Reuters ToS. Store summary/lead paragraphs only.'),
  
  -- AP News US
  (2, 'AP News US', FALSE, 1200, 
   'Excerpt only per AP ToS. Brief summary with attribution.'),
  
  -- NYT Politics
  (3, 'NYT Politics', FALSE, 1200, 
   'Excerpt only per NYT ToS. Lead paragraphs with paywall link.'),
  
  -- WaPo Politics
  (4, 'WaPo Politics', FALSE, 1200, 
   'Excerpt only per WaPo ToS. Summary with link to full article.'),
  
  -- Politico Top
  (5, 'Politico Top', FALSE, 1200, 
   'Excerpt only per Politico ToS. Brief summary with attribution.')

ON CONFLICT (feed_id) DO UPDATE 
SET 
  source_name = EXCLUDED.source_name,
  allow_full_text = EXCLUDED.allow_full_text,
  max_chars = EXCLUDED.max_chars,
  notes = EXCLUDED.notes;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== Compliance Rules Verification ===';
END $$;

-- Show all compliance rules
SELECT 
  cr.feed_id,
  f.feed_name,
  cr.source_name,
  cr.allow_full_text,
  cr.max_chars,
  cr.notes
FROM public.feed_compliance_rules cr
JOIN public.feed_registry f ON f.id = cr.feed_id
ORDER BY cr.feed_id;

-- Count rules vs feeds (should match)
SELECT 
  (SELECT COUNT(*) FROM public.feed_registry WHERE is_active = TRUE) as active_feeds,
  (SELECT COUNT(*) FROM public.feed_compliance_rules) as compliance_rules,
  CASE 
    WHEN (SELECT COUNT(*) FROM public.feed_registry WHERE is_active = TRUE) = 
         (SELECT COUNT(*) FROM public.feed_compliance_rules)
    THEN '✓ All active feeds have rules'
    ELSE '⚠️ Mismatch - some feeds missing rules'
  END as status;

-- ============================================================================
-- NOTES FOR FUTURE FEED ADDITIONS
-- ============================================================================
--
-- When adding a new feed, ALWAYS add a compliance rule:
--
-- INSERT INTO public.feed_compliance_rules (feed_id, source_name, allow_full_text, max_chars, notes)
-- VALUES 
--   (NEW_FEED_ID, 'Source Display Name', FALSE, 1200, 'ToS compliance notes')
-- ON CONFLICT (feed_id) DO UPDATE 
-- SET allow_full_text = EXCLUDED.allow_full_text,
--     max_chars = EXCLUDED.max_chars,
--     notes = EXCLUDED.notes;
--
-- Default: allow_full_text = FALSE, max_chars = 1200 (unless feed ToS is more restrictive)
--
-- ============================================================================
-- SEED COMPLETE
-- ============================================================================
--
-- ✅ Success indicators:
-- - 5 active feeds have compliance rules (Feed 6 deleted in TTRC-242)
-- - Excerpt limits set to 1200 chars (≈200-250 words)
-- - All feeds: allow_full_text = FALSE
--
-- ➡️ Next step: TTRC-247 (Post-deployment verification)
--
-- ============================================================================
