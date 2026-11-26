-- PROD one-off, November 25, 2026: catch up the Tracker main-line flags.
-- refresh_tracker_derived() has timed out on every PROD RSS run since November 12
-- (refresh-tracker: FAILED ... statement timeout). The label backfill (ADO-594) changed
-- the rule's input for thousands of old stories, so ~2,760 main_line flags are pending
-- and each run's attempt is cancelled and rolled back. Homepage main line stuck at
-- November 11.
-- This is the same call the RSS pipeline makes every run; it only gets more time.
-- Safe to re-run: it updates only rows whose flag differs from the rule.
-- Expected result: one row, rows_changed about 2,700-3,000, took_ms under 120000.
SET statement_timeout = '120s';
SELECT * FROM public.refresh_tracker_derived();
