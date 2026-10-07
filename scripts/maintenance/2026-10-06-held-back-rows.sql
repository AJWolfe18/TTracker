-- One-time PROD fix (October 6, 2026): rows held off the site by review flags.
-- Run on PROD only, AFTER migration 128 (the script stops if 128 is missing).
-- Each step checks its exact row set first and changes nothing on a mismatch; a second run is a no-op.
-- Result: the NOTICE lines (Messages tab) say how many rows each step changed.
--
-- STEP 1 - EOs: republish the 2 EOs the old trigger hid (14426 level-0 auto-flag, 14433 named-actor
--          doubt). The flag stays set, so both remain on the admin Needs Review list for a look.
-- STEP 2 - SCOTUS (ADO-603 AC 4): put the 49 pre-agent GPT-pipeline rows (prompt_version
--          v2-ado280-flagged, enrichment_status flagged, never enriched, never public) back in the
--          Claude agent's queue. The agent only reads pending/failed, so these sat hidden since spring.
--          It writes them up 20 per weekday run (about 3 runs) and publishes them, as it does every case.

DO $$
DECLARE
  v_src     text;
  v_matched integer;
  v_changed integer;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname = 'sync_eo_needs_review_from_log';
  IF v_src IS NULL OR position('is_public' in v_src) > 0 THEN
    RAISE EXCEPTION 'Migration 128 is not applied (the EO flag trigger still unpublishes). Nothing changed.';
  END IF;

  -- STEP 1: EOs
  SELECT count(*) INTO v_matched FROM public.executive_orders
   WHERE (id, order_number::text) IN (('eo_a9a9035e-0752-4329-82b3-37b522948a3b', '14433'),
                                      ('eo_e6a2d4f6-f2d6-48c9-aa52-63e92407a0bb', '14426'));
  IF v_matched <> 2 THEN
    RAISE EXCEPTION 'EO step: expected 2 id/order matches, found %. Nothing changed.', v_matched;
  END IF;

  UPDATE public.executive_orders
     SET is_public = true
   WHERE id IN ('eo_a9a9035e-0752-4329-82b3-37b522948a3b', 'eo_e6a2d4f6-f2d6-48c9-aa52-63e92407a0bb')
     AND is_public = false
     AND prompt_version = 'v1.1'
     AND enriched_at IS NOT NULL;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RAISE NOTICE 'EO step: % of 2 EOs republished (0 means it already ran).', v_changed;

  -- STEP 2: SCOTUS legacy flagged rows
  SELECT count(*) INTO v_matched FROM public.scotus_cases
   WHERE id IN (1513, 1514, 1515, 1517, 1519, 1521, 1522, 1523, 1524, 1527, 1538, 1539, 1541, 1547,
                1548, 1550, 1551, 1552, 1559, 1562, 1568, 1570, 1575, 1581, 1604, 1610, 1611, 1615,
                1616, 1633, 1647, 1668, 1693, 1694, 1695, 1699, 1706, 1707, 1712, 1713, 1714, 1715,
                1716, 1720, 1721, 1724, 1726, 1749, 1762)
     AND ((prompt_version = 'v2-ado280-flagged' AND enrichment_status = 'flagged' AND enriched_at IS NULL)
          OR enrichment_status IN ('pending', 'enriched', 'failed'));
  IF v_matched <> 49 THEN
    RAISE EXCEPTION 'SCOTUS step: expected 49 legacy rows, found %. Nothing changed.', v_matched;
  END IF;

  UPDATE public.scotus_cases
     SET enrichment_status     = 'pending',
         enriched_at           = NULL,
         prompt_version        = NULL,
         needs_manual_review   = false,
         low_confidence_reason = NULL
   WHERE id IN (1513, 1514, 1515, 1517, 1519, 1521, 1522, 1523, 1524, 1527, 1538, 1539, 1541, 1547,
                1548, 1550, 1551, 1552, 1559, 1562, 1568, 1570, 1575, 1581, 1604, 1610, 1611, 1615,
                1616, 1633, 1647, 1668, 1693, 1694, 1695, 1699, 1706, 1707, 1712, 1713, 1714, 1715,
                1716, 1720, 1721, 1724, 1726, 1749, 1762)
     AND prompt_version = 'v2-ado280-flagged'
     AND enrichment_status = 'flagged'
     AND enriched_at IS NULL;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RAISE NOTICE 'SCOTUS step: % of 49 rows re-queued (0 means it already ran).', v_changed;
END $$;

-- AFTER (read-only, optional): expect scotus pending = 49 until the agent runs, eo hidden_flagged = 0
-- SELECT 'scotus pending' AS what, count(*) FROM scotus_cases WHERE enrichment_status = 'pending'
-- UNION ALL SELECT 'eo hidden_flagged', count(*) FROM executive_orders WHERE needs_manual_review AND NOT is_public;
