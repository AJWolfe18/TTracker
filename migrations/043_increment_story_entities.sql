-- ============================================================================
-- Migration 043: Atomic Story Entity Aggregation RPC
-- ============================================================================
-- Ticket: TTRC-298 (Article-level entity extraction)
-- Purpose: Atomic entity counter updates when articles attach to stories
-- Benefits:
--   - Prevents race conditions (FOR UPDATE row lock)
--   - Single DB call instead of SELECT+UPDATE
--   - Future-proofs for parallel clustering
-- Date: 2025-12-08
-- ============================================================================

-- Create atomic RPC for entity aggregation
CREATE OR REPLACE FUNCTION increment_story_entities(
  p_story_id BIGINT,
  p_entity_ids TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_counter JSONB;
  v_id TEXT;
BEGIN
  -- Lock row to prevent race conditions during concurrent clustering
  SELECT COALESCE(entity_counter, '{}'::jsonb)
  INTO v_counter
  FROM stories
  WHERE id = p_story_id
  FOR UPDATE;

  -- Handle case where story doesn't exist (shouldn't happen, but defensive)
  IF NOT FOUND THEN
    RAISE WARNING 'increment_story_entities: story % not found', p_story_id;
    RETURN;
  END IF;

  -- Increment counter for each entity ID
  FOREACH v_id IN ARRAY p_entity_ids LOOP
    v_counter := jsonb_set(
      v_counter,
      ARRAY[v_id],
      to_jsonb(COALESCE((v_counter ->> v_id)::int, 0) + 1)
    );
  END LOOP;

  -- Update story with new counter and derived top_entities (top 8 by count)
  UPDATE stories
  SET
    entity_counter = v_counter,
    top_entities = (
      SELECT ARRAY(
        SELECT key
        FROM jsonb_each(v_counter) AS t(key, val)
        ORDER BY (val::int) DESC
        LIMIT 8
      )
    )
  WHERE id = p_story_id;
END;
$$;

COMMENT ON FUNCTION increment_story_entities(BIGINT, TEXT[]) IS
'Atomically increments entity_counter and updates top_entities when article attaches to story.
Uses FOR UPDATE lock to prevent race conditions. Called from hybrid-clustering.js.
Created in migration 043 for TTRC-298.';

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION increment_story_entities(BIGINT, TEXT[]) TO service_role;
