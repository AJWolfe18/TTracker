-- ============================================================================
-- Migration 033: Validation Helper RPCs
-- ============================================================================
-- Created: 2025-11-16
-- Ticket: TTRC-266 (Phase 0A)
-- Purpose: Provide helper functions for validating database prerequisites
--          before implementing RSS inline automation
--
-- This migration MUST be applied before migration 034 (rss_tracker_inline)
-- ============================================================================

BEGIN;

-- 1. RPC existence and signature checker
-- Used by validation script to verify required RPCs exist with correct arg counts
CREATE OR REPLACE FUNCTION pg_proc_check(proc_name TEXT)
RETURNS TABLE (arg_count INTEGER)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT p.pronargs::INTEGER
  FROM pg_proc p
  WHERE p.proname = proc_name
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION pg_proc_check IS
  'Helper for validation script (TTRC-266). Checks if RPC exists and returns argument count. Used to verify prerequisites before applying migration 034.';

-- 2. Column existence checker
-- Used by validation script to verify required columns exist on tables
CREATE OR REPLACE FUNCTION check_columns_exist(
  table_name TEXT,
  column_names TEXT[]
)
RETURNS TABLE (all_exist BOOLEAN, missing_columns TEXT[])
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  existing_columns TEXT[];
  missing TEXT[];
BEGIN
  -- Get existing columns for table
  SELECT ARRAY_AGG(column_name::TEXT)
  INTO existing_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = check_columns_exist.table_name
    AND column_name = ANY(column_names);

  -- Find missing columns
  SELECT ARRAY_AGG(col)
  INTO missing
  FROM UNNEST(column_names) AS col
  WHERE col NOT IN (SELECT UNNEST(COALESCE(existing_columns, ARRAY[]::TEXT[])));

  RETURN QUERY SELECT
    (COALESCE(ARRAY_LENGTH(missing, 1), 0) = 0) AS all_exist,
    COALESCE(missing, ARRAY[]::TEXT[]) AS missing_columns;
END;
$$;

COMMENT ON FUNCTION check_columns_exist IS
  'Helper for validation script (TTRC-266). Verifies that all required columns exist on a table. Returns boolean flag and array of missing column names.';

-- 3. Grant permissions
-- Grant to service role for script execution
GRANT EXECUTE ON FUNCTION pg_proc_check(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION check_columns_exist(TEXT, TEXT[]) TO service_role;

-- Also grant to authenticated for manual testing/debugging
GRANT EXECUTE ON FUNCTION pg_proc_check(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION check_columns_exist(TEXT, TEXT[]) TO authenticated;

COMMIT;

-- ============================================================================
-- Post-migration verification
-- ============================================================================
-- Run these queries to verify migration succeeded:
--
-- SELECT * FROM pg_proc_check('pg_proc_check');
-- -- Expected: Returns row with arg_count = 1
--
-- SELECT * FROM check_columns_exist('feed_registry', ARRAY['id', 'url', 'source_name']);
-- -- Expected: all_exist = true, missing_columns = {}
--
-- SELECT * FROM check_columns_exist('feed_registry', ARRAY['nonexistent_column']);
-- -- Expected: all_exist = false, missing_columns = {nonexistent_column}
-- ============================================================================
