# TTRC-298: Article Entity Extraction - PROD Deploy Guide

**Date:** 2025-12-08
**Status:** Ready for PROD
**TEST Commit:** `79a7152`
**Branch:** test

---

## Summary

Added article-level entity extraction to the RSS pipeline. Entities enable 25% weight in hybrid clustering scoring, improving story grouping accuracy.

---

## TEST Validation Results

| Metric | Result |
|--------|--------|
| Pipeline run | ✅ Success |
| Entities extracted | 20 articles |
| Cost per run | ~$0.0014 |
| AI code review | ✅ Passed |
| RPC tested | ✅ Working |

---

## PROD Deployment Steps

### Step 1: Apply Migrations via Supabase SQL Editor

**Go to:** Supabase Dashboard > TrumpyTracker (PROD) > SQL Editor

#### Migration 1: `043_increment_story_entities.sql`

```sql
-- Atomic entity counter increment for stories
-- TTRC-298: Called when articles attach to stories
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
  SELECT COALESCE(entity_counter, '{}'::jsonb)
  INTO v_counter
  FROM stories
  WHERE id = p_story_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE WARNING 'increment_story_entities: story % not found', p_story_id;
    RETURN;
  END IF;

  FOREACH v_id IN ARRAY p_entity_ids LOOP
    v_counter := jsonb_set(
      v_counter,
      ARRAY[v_id],
      to_jsonb(COALESCE((v_counter ->> v_id)::int, 0) + 1)
    );
  END LOOP;

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

GRANT EXECUTE ON FUNCTION increment_story_entities(BIGINT, TEXT[]) TO service_role;
```

#### Migration 2: `044_run_stats_entities_extracted.sql`

```sql
-- Add entities_extracted column to run_stats
ALTER TABLE admin.run_stats
  ADD COLUMN IF NOT EXISTS entities_extracted INT NOT NULL DEFAULT 0;

-- Drop old 15-param RPC
DROP FUNCTION IF EXISTS public.log_run_stats(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  INT, INT, INT, INT, INT, INT, INT, INT,
  NUMERIC, INT, INT
);

-- Create new 16-param RPC
CREATE OR REPLACE FUNCTION public.log_run_stats(
  p_environment TEXT,
  p_run_started_at TIMESTAMPTZ,
  p_run_finished_at TIMESTAMPTZ,
  p_status TEXT,
  p_feeds_total INT,
  p_feeds_processed INT,
  p_feeds_succeeded INT,
  p_feeds_failed INT,
  p_feeds_skipped_lock INT,
  p_feeds_304_cached INT,
  p_stories_clustered INT,
  p_stories_enriched INT,
  p_total_openai_cost_usd NUMERIC,
  p_enrichment_skipped_budget INT,
  p_enrichment_failed INT DEFAULT 0,
  p_entities_extracted INT DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin
AS $func$
BEGIN
  INSERT INTO admin.run_stats (
    environment, run_started_at, run_finished_at, status,
    feeds_total, feeds_processed, feeds_succeeded, feeds_failed,
    feeds_skipped_lock, feeds_304_cached,
    stories_clustered, stories_enriched,
    total_openai_cost_usd, enrichment_skipped_budget,
    enrichment_failed, entities_extracted
  )
  VALUES (
    p_environment, p_run_started_at, p_run_finished_at, p_status,
    p_feeds_total, p_feeds_processed, p_feeds_succeeded, p_feeds_failed,
    p_feeds_skipped_lock, p_feeds_304_cached,
    p_stories_clustered, p_stories_enriched,
    p_total_openai_cost_usd, p_enrichment_skipped_budget,
    p_enrichment_failed, p_entities_extracted
  );
END;
$func$;

REVOKE ALL ON FUNCTION public.log_run_stats(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  INT, INT, INT, INT, INT, INT, INT, INT,
  NUMERIC, INT, INT, INT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.log_run_stats(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT,
  INT, INT, INT, INT, INT, INT, INT, INT,
  NUMERIC, INT, INT, INT
) TO service_role;
```

### Step 2: Verify Migrations

Run these queries to confirm:

```sql
-- Check RPC exists
SELECT proname FROM pg_proc WHERE proname = 'increment_story_entities';

-- Check run_stats column exists
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'admin' AND table_name = 'run_stats'
AND column_name = 'entities_extracted';
```

### Step 3: Cherry-pick Code to PROD

```bash
# Create deployment branch from main
git checkout main
git pull origin main
git checkout -b deploy/ttrc-298

# Cherry-pick the commit
git cherry-pick 79a7152

# Push and create PR
git push origin deploy/ttrc-298
gh pr create --base main --title "feat(TTRC-298): article entity extraction" --body "Cherry-pick from test. Migrations applied manually."
```

### Step 4: Merge PR

After PR approval, merge to main. Auto-deploys to trumpytracker.com.

### Step 5: Verify PROD

After first scheduled run (every 2 hours), check:

```sql
-- Articles with entities
SELECT COUNT(*) FROM articles WHERE entities != '[]'::jsonb;

-- Stories with entity_counter
SELECT COUNT(*) FROM stories WHERE entity_counter != '{}'::jsonb;
```

---

## Files Changed

| File | Description |
|------|-------------|
| `scripts/enrichment/extract-article-entities-inline.js` | NEW - shared extraction module |
| `scripts/rss-tracker-supabase.js` | Added entity extraction phase |
| `scripts/rss/hybrid-clustering.js` | Entity seeding + RPC call |
| `scripts/backfill-article-entities-inline.js` | DRY refactor |
| `migrations/043_increment_story_entities.sql` | Atomic RPC |
| `migrations/044_run_stats_entities_extracted.sql` | Observability |

---

## Cost Impact

- Per article: ~$0.00009
- Per run (~50 articles): ~$0.005
- Monthly estimate: ~$1.60

---

## Rollback Plan

If issues occur:

1. Comment out `await this.extractArticleEntitiesPhase();` in `rss-tracker-supabase.js`
2. Pipeline continues without entity extraction (falls back to embeddings + title)

No need to drop RPC or reset data - entities are enhancement, not critical path.

---

## Related

- **Stage 1:** Prompt fix (commit `8cd71d6`) - already in test
- **P2 Backlog:** Historical story entity backfill
