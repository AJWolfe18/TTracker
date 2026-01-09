-- Migration 026: Backfill Filter Configs for Existing Feeds
-- Part of TTRC-264 - Add filter configs to 8 existing feeds
-- Applies proven filtering logic from TTRC-263 to all active feeds

-- Update NYT Politics (feed_id 3)
UPDATE feed_registry SET filter_config = jsonb_build_object(
  'allow', ARRAY['Trump','Congress','White House','Supreme Court','SCOTUS','executive order','DOJ','federal'],
  'block', ARRAY['city council','school board','mayor','state legislature','gubernatorial'],
  'disallowedUrlIncludes', ARRAY['/opinion/','/live/','/video/','/podcasts/']
) WHERE id = 3;

-- Update WaPo Politics (feed_id 4)
UPDATE feed_registry SET filter_config = jsonb_build_object(
  'allow', ARRAY['Trump','Congress','White House','Supreme Court','SCOTUS','federal','DOJ'],
  'block', ARRAY['city council','mayor','state legislature','gubernatorial'],
  'disallowedUrlIncludes', ARRAY['/opinions/','/local/','/video/']
) WHERE id = 4;

-- Update Politico Top (feed_id 5)
UPDATE feed_registry SET filter_config = jsonb_build_object(
  'allow', ARRAY['Trump','Congress','White House','Supreme Court','federal'],
  'block', ARRAY['city council','county','mayor','state legislature'],
  'disallowedUrlIncludes', ARRAY['/opinion/','/video/','/podcasts/']
) WHERE id = 5;

-- Update Christian Science Monitor (feed_id 175)
UPDATE feed_registry SET filter_config = jsonb_build_object(
  'allow', ARRAY['Trump','Congress','White House','Supreme Court','federal','DOJ'],
  'block', ARRAY['city council','school board','mayor','Maine','gubernatorial','state legislature'],
  'disallowedUrlIncludes', ARRAY['/opinion/','/commentary/']
) WHERE id = 175;

-- Update PBS NewsHour (feed_id 176)
UPDATE feed_registry SET filter_config = jsonb_build_object(
  'allow', ARRAY['Trump','Congress','White House','Supreme Court','federal policy'],
  'block', ARRAY['city council','mayor','state legislature','gubernatorial'],
  'disallowedUrlIncludes', ARRAY['/video/','/segments/']
) WHERE id = 176;

-- Update ProPublica (feed_id 177)
-- Note: Feed currently has 5 failures - may need URL investigation
UPDATE feed_registry SET filter_config = jsonb_build_object(
  'allow', ARRAY['Trump','Congress','White House','federal investigation','DOJ','FBI'],
  'block', ARRAY['city council','school board','local government','state legislature'],
  'disallowedUrlIncludes', ARRAY['/local/','/state/']
) WHERE id = 177;

-- Update Time Politics (feed_id 178)
UPDATE feed_registry SET filter_config = jsonb_build_object(
  'allow', ARRAY['Trump','Congress','White House','Supreme Court','federal'],
  'block', ARRAY['city council','mayor','state legislature','gubernatorial'],
  'disallowedUrlIncludes', ARRAY['/opinion/','/video/']
) WHERE id = 178;

-- Update The Economist US (feed_id 181)
UPDATE feed_registry SET filter_config = jsonb_build_object(
  'allow', ARRAY['Trump','Congress','White House','federal policy','Supreme Court'],
  'block', ARRAY['city council','mayor','state legislature','gubernatorial'],
  'disallowedUrlIncludes', ARRAY['/opinion/','/blogs/']
) WHERE id = 181;

-- Verify updates
DO $$
DECLARE
  v_configured_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_configured_count
  FROM feed_registry
  WHERE is_active = true
    AND filter_config != '{}'::jsonb;

  RAISE NOTICE 'Migration 026 complete: % active feeds now have filter configs', v_configured_count;

  IF v_configured_count < 11 THEN
    RAISE WARNING 'Expected 11 configured feeds, found %', v_configured_count;
  END IF;
END $$;
