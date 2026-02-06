-- Migration: 083_admin_rpc_functions.sql
-- Purpose: Create RPC functions for content history logging and undo
-- ADO: Feature 328, Story 337

-- Function to log a content change
CREATE OR REPLACE FUNCTION log_content_change(
  p_entity_type text,
  p_entity_id text,
  p_field_name text,
  p_old_value text,
  p_new_value text,
  p_changed_by text,
  p_change_source text DEFAULT 'admin'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO admin.content_history (
    entity_type, entity_id, field_name,
    old_value, new_value, changed_by, change_source
  ) VALUES (
    p_entity_type, p_entity_id, p_field_name,
    p_old_value, p_new_value, p_changed_by, p_change_source
  );
END;
$$;

-- Function to undo the most recent change for an entity
CREATE OR REPLACE FUNCTION undo_content_change(
  p_entity_type text,
  p_entity_id text,
  p_changed_by text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_history admin.content_history%ROWTYPE;
  v_table_name text;
BEGIN
  -- Get most recent change for this entity
  SELECT * INTO v_history
  FROM admin.content_history
  WHERE entity_type = p_entity_type
    AND entity_id = p_entity_id
  ORDER BY changed_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No history found');
  END IF;

  -- Map entity type to table name
  v_table_name := CASE p_entity_type
    WHEN 'story' THEN 'stories'
    WHEN 'pardon' THEN 'pardons'
    WHEN 'scotus' THEN 'scotus_cases'
    WHEN 'eo' THEN 'executive_orders'
    WHEN 'feed' THEN 'feed_registry'
    WHEN 'article' THEN 'articles'
    ELSE NULL
  END;

  IF v_table_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown entity type');
  END IF;

  -- Execute the undo (articles use TEXT id, others use BIGINT)
  IF p_entity_type = 'article' THEN
    EXECUTE format(
      'UPDATE %I SET %I = $1 WHERE id = $2',
      v_table_name, v_history.field_name
    ) USING v_history.old_value, p_entity_id;
  ELSE
    EXECUTE format(
      'UPDATE %I SET %I = $1 WHERE id = $2',
      v_table_name, v_history.field_name
    ) USING v_history.old_value, p_entity_id::bigint;
  END IF;

  -- Log the undo as a new change (creates audit trail)
  INSERT INTO admin.content_history (
    entity_type, entity_id, field_name,
    old_value, new_value, changed_by, change_source
  ) VALUES (
    p_entity_type, p_entity_id, v_history.field_name,
    v_history.new_value, v_history.old_value, p_changed_by, 'undo'
  );

  RETURN jsonb_build_object(
    'success', true,
    'field', v_history.field_name,
    'restored_value', v_history.old_value
  );
END;
$$;

-- Function to log an admin action (for audit trail)
CREATE OR REPLACE FUNCTION log_admin_action(
  p_user_id text,
  p_action text,
  p_entity_type text,
  p_entity_id text DEFAULT NULL,
  p_entity_ids text[] DEFAULT NULL,
  p_details jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO admin.action_log (
    user_id, action, entity_type, entity_id, entity_ids, details
  ) VALUES (
    p_user_id, p_action, p_entity_type, p_entity_id, p_entity_ids, p_details
  );
END;
$$;

-- Grant execute to authenticated role (functions use SECURITY DEFINER)
GRANT EXECUTE ON FUNCTION log_content_change TO authenticated;
GRANT EXECUTE ON FUNCTION undo_content_change TO authenticated;
GRANT EXECUTE ON FUNCTION log_admin_action TO authenticated;

COMMENT ON FUNCTION log_content_change IS 'Logs a field-level change for undo support';
COMMENT ON FUNCTION undo_content_change IS 'Undoes the most recent change for an entity, returns the restored value';
COMMENT ON FUNCTION log_admin_action IS 'Logs an admin action for audit trail';
