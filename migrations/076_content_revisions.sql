-- 076_content_revisions.sql
-- SCOTUS-only content revision history (editorial snapshots only)

BEGIN;

CREATE TABLE IF NOT EXISTS public.content_revisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content_type TEXT NOT NULL DEFAULT 'scotus_case',
  content_id BIGINT NOT NULL,                 -- scotus_cases.id
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger_source TEXT NOT NULL,
  trigger_id TEXT,
  snapshot JSONB NOT NULL,
  changed_fields TEXT[] NOT NULL DEFAULT '{}',
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT,
  change_summary TEXT,

  CONSTRAINT content_revisions_scotus_only CHECK (content_type = 'scotus_case'),
  CONSTRAINT content_revisions_trigger_source CHECK (
    trigger_source IN ('enrichment','qa_auto_fix','manual_edit','admin_override','batch_rerun')
  )
);

CREATE INDEX IF NOT EXISTS idx_content_revisions_content
  ON public.content_revisions (content_type, content_id, created_at DESC, id DESC);

-- Keep last N revisions per content_id (SCOTUS-only)
CREATE OR REPLACE FUNCTION public.trim_content_revisions_scotus(
  p_content_id BIGINT,
  p_keep INT DEFAULT 20
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM public.content_revisions
  WHERE content_type = 'scotus_case'
    AND content_id = p_content_id
    AND id NOT IN (
      SELECT id
      FROM public.content_revisions
      WHERE content_type = 'scotus_case'
        AND content_id = p_content_id
      ORDER BY created_at DESC, id DESC
      LIMIT p_keep
    );
END;
$$;

-- Single helper: insert + trim
CREATE OR REPLACE FUNCTION public.add_content_revision_scotus(
  p_content_id BIGINT,
  p_trigger_source TEXT,
  p_trigger_id TEXT,
  p_snapshot JSONB,
  p_changed_fields TEXT[] DEFAULT '{}',
  p_actor_type TEXT DEFAULT 'system',
  p_actor_id TEXT DEFAULT NULL,
  p_change_summary TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO public.content_revisions (
    content_type, content_id, trigger_source, trigger_id,
    snapshot, changed_fields, actor_type, actor_id, change_summary
  )
  VALUES (
    'scotus_case', p_content_id, p_trigger_source, p_trigger_id,
    p_snapshot, COALESCE(p_changed_fields,'{}'), COALESCE(p_actor_type,'system'), p_actor_id, p_change_summary
  )
  RETURNING id INTO v_id;

  PERFORM public.trim_content_revisions_scotus(p_content_id, 20);

  RETURN v_id;
END;
$$;

COMMIT;
