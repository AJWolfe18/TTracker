-- Migration: 118_lock_down_undo_content_change.sql
-- ADO-525 (+ the undo items of ADO-353). Security: undo_content_change was a SECURITY DEFINER
-- RPC that anon could EXECUTE (migration 083), and admin.html called it with the public anon key,
-- so anyone holding that key could revert the latest logged admin change on any entity.
-- Admin Undo now goes through the password-gated edge function admin-undo (service role).
--
-- DEPLOY ORDER ON PROD (or Undo breaks between steps):
--   1. deploy edge function admin-undo, 2. ship admin.html (it calls admin-undo), 3. run this.
--
-- What this does:
--   A) Recreates undo_content_change with:
--      - scalar variables instead of admin.content_history%ROWTYPE (the SQL Editor's
--        "Enable RLS" helper mangles %ROWTYPE declarations when pasted),
--      - the target table schema-qualified (public.%I),
--      - a row-count check: an entity that no longer exists returns an error and writes no history,
--      - EO and article ids compared as text (PROD executive_orders.id is VARCHAR 'eo_...';
--        the old ::bigint cast broke EO undo on PROD),
--      - the same search_path migration 095 set.
--   B) Revokes EXECUTE from PUBLIC, anon, authenticated; grants service_role only.
-- Idempotent: CREATE OR REPLACE + REVOKE/GRANT by name and arg count (pattern from 095).

CREATE OR REPLACE FUNCTION public.undo_content_change(
  p_entity_type text,
  p_entity_id text,
  p_changed_by text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_field text;
  v_old text;
  v_new text;
  v_table text;
  v_rows int;
BEGIN
  -- Most recent logged change for this entity
  v_field := NULL;
  SELECT h.field_name, h.old_value, h.new_value
    INTO v_field, v_old, v_new
    FROM admin.content_history h
   WHERE h.entity_type = p_entity_type
     AND h.entity_id = p_entity_id
   ORDER BY h.changed_at DESC
   LIMIT 1;

  IF v_field IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No history found');
  END IF;

  v_table := CASE p_entity_type
    WHEN 'story' THEN 'stories'
    WHEN 'pardon' THEN 'pardons'
    WHEN 'scotus' THEN 'scotus_cases'
    WHEN 'eo' THEN 'executive_orders'
    WHEN 'feed' THEN 'feed_registry'
    WHEN 'article' THEN 'articles'
    ELSE NULL
  END;

  IF v_table IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown entity type');
  END IF;

  IF p_entity_type IN ('eo', 'article') THEN
    EXECUTE format('UPDATE public.%I SET %I = $1 WHERE id::text = $2', v_table, v_field)
      USING v_old, p_entity_id;
  ELSE
    EXECUTE format('UPDATE public.%I SET %I = $1 WHERE id = $2', v_table, v_field)
      USING v_old, p_entity_id::bigint;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Entity not found');
  END IF;

  -- Log the undo as a new change (audit trail)
  INSERT INTO admin.content_history (
    entity_type, entity_id, field_name,
    old_value, new_value, changed_by, change_source
  ) VALUES (
    p_entity_type, p_entity_id, v_field,
    v_new, v_old, p_changed_by, 'undo'
  );

  RETURN jsonb_build_object(
    'success', true,
    'field', v_field,
    'restored_value', v_old
  );
END;
$$;

COMMENT ON FUNCTION public.undo_content_change(text, text, text) IS
  'Undoes the most recent logged change for an entity. service_role only: admin Undo calls it through the password-gated admin-undo edge function (ADO-525).';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'undo_content_change' AND p.pronargs = 3
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.oid::regprocedure);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- VERIFY (read-only). Expected: anon=f, authenticated=f, service_role=t,
-- proconfig = {search_path=pg_catalog, public, extensions}
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role,
       p.proconfig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'undo_content_change';
