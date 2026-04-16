# ADO-466 Session 1: Silent Skip Visibility — Audit + Schema

**Date:** 2026-04-12
**Ticket:** ADO-466 (Active)
**Branch:** test (pushed)
**Commits:** c2e28f2, 306b80c, 32bcf36

## What Was Done

### Audit
Walked the codebase to verify which of 12 original silent-skip locations still exist. Result: scope shrinks to **8 live locations**, plus 2 newly discovered.

**Dropped (4):**
- #1, #2 Scout triage — Scout (`scotus-scout.js`) is dead code post-Claude-agent
- #7 Scout parse errors — same reason
- #11 GPT cross-check — already fixed via `fact_check_issues` JSONB field

**Live (8 to instrument next session):**

| # | Where | Reason |
|---|-------|--------|
| HIGH 3 | `scripts/rss-tracker-supabase.js:309` | RSS budget cap skips entity extraction |
| HIGH 4 | `scripts/rss-tracker-supabase.js:274` | Embedding failures, retry infinitely |
| HIGH 5 | `scripts/rss/fetch_feed.js:442` | Freshness filter drops old articles silently |
| HIGH 6 | `scripts/enrichment/enrich-stories-inline.js:237` | Story enrichment with no articles |
| MED 8 | `scripts/aggregate-story-entities.js:116` | Aggregation finds no entities |
| MED 9 | `scripts/enrichment/extract-article-entities-inline.js:147` | JSON parse error |
| MED 10 | `scripts/rss/fetch_feed.js:442` | Same line as #5, freshness |
| MED 12 | `scripts/rss-tracker-supabase.js:309` | Same line as #3, budget-blocked |
| NEW A | `scripts/enrichment/extract-article-entities-inline.js:171` | API errors return empty silently |
| NEW B | `scripts/aggregate-story-entities.js:90` | Stories with empty article lists |

### PROD stability verified
Before dropping the Scout items from scope, confirmed Claude cloud agent has been running cleanly in PROD:
- 5/5 weekdays since 2026-04-05, all `completed`
- PROD `scotus_cases`: 1,381 total / 116 enriched / **0 pending / 0 failed**
- No hot-fixes or rollbacks touching SCOTUS enrichment in the last 7 days

### Schema committed (306b80c)
`supabase/migrations/20260412000000_pipeline_skips.sql`:
```sql
CREATE TABLE pipeline_skips (
  id BIGSERIAL PRIMARY KEY,
  pipeline TEXT NOT NULL,
  reason TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- + indexes on created_at and (pipeline, reason, created_at)
```

### Helper committed (306b80c + 32bcf36)
`scripts/lib/skip-reasons.js` — CommonJS module exporting:
- `PIPELINES` frozen enum (rss_fetch, rss_enrichment, embeddings, entity_extraction, entity_aggregation, story_enrichment)
- `REASONS` frozen enum (budget_exceeded, freshness_filter, no_articles, no_entities, embedding_failure, max_retries_exceeded, parse_error, api_error)
- `recordSkip(supabase, {pipeline, reason, entity_type, entity_id, metadata})` — never throws, logs insert failures

### Workflow cleanup committed (c2e28f2)
`.github/workflows/scotus-tracker.yml` — removed:
- "Enrich cases (PROD)" step (was a 3-second no-op since 2026-04-05)
- `OPENAI_API_KEY` env (only used by removed step)
- `limit` + `skip_enrich` workflow_dispatch inputs (only fed removed step)
- `LIMIT` env var (same)
- Dead `skip_enrich` reference on budget guard's `if:` condition

Fetch step + budget guard remain (fetch is needed upstream of Claude agent; budget guard flagged as now-pointless but not deleted — see next session).

### Spin-off card created
**ADO-473** (parent: ADO-467 SCOTUS Claude Agent epic) — "Retire legacy SCOTUS enrichment scripts". Full dead-code cleanup of ~12 files. Tags failed on create (permissions error TF401289) — Josh may need to add `scotus; technical-debt; cleanup` manually.

## Key Decisions (and WHY)

1. **Free-form TEXT over CHECK constraint for pipeline/reason.** Faster iteration on a new observability feature where we may discover more reasons. Typos guarded by shared constants file — typos fail JS lookup immediately rather than silently writing malformed rows. Can upgrade to enum later if needed.

2. **`recordSkip` never throws.** Skip-logging must not break the pipeline it's observing. Insert failures are logged and swallowed.

3. **30-day retention, cron deferred.** No skip rows are written yet, so the table will stay empty until next session. Safer to add retention cron after instrumentation.

4. **Scout + `enrich-scotus.js` declared dead, but cleanup deferred to ADO-473.** Too much scope for one session. Prereq done (workflow trim) so ADO-473 is unblocked.

## Code Review Results (feature-dev:code-reviewer)

**Verdict: LGTM (minor).**

Fixes applied in this session:
- JSDoc on `entity_id` clarified (`string|number|null` instead of `string`) — commit 32bcf36

Flagged for follow-up (not fixed this session):
- **Budget guard in scotus-tracker.yml lines 68-95 now gates nothing meaningful and exits 1 on DB hiccup** — real risk of spurious workflow failures. Recommend either softening to warn-only (change `exit 1` to `exit 0`) or removing the step entirely. Fold into ADO-473 or fix at start of next session.

QA smoke: boundaries test passed; integration test failed locally due to missing `SUPABASE_URL` env var (unrelated to these commits).

## What's Next (Session 2 — Step 2 of ADO-466)

1. **Apply migration** `20260412000000_pipeline_skips.sql` to TEST DB. Supabase MCP only connects to WhiskeyPal, so Josh pastes into Supabase Dashboard SQL Editor OR we use the `supabase` CLI locally.
2. **Fix budget guard** in `scotus-tracker.yml` (soften or remove). 5-minute task.
3. **Instrument 10 call sites** with `recordSkip()` imports. Small, repetitive — good candidate for parallel subagents once pattern is set on the first one.
4. **Build admin dashboard card** in `public/admin.html`:
   - Counts by pipeline (last 24h / 7d / 30d)
   - Drill-down: pipeline → reason → recent rows with `entity_id` + `metadata`
   - Filters: time range, pipeline, reason
5. **Add 30-day retention cron** (pg_cron not in use — probably a GitHub Actions workflow + SQL).
6. **Verification:** force a skip in each of the 10 locations and confirm it appears in the admin card.
7. **Docs:** add "every skip writes status" rule to `CLAUDE.md` anti-patterns.
8. **AC verification** against all 7 ADO-466 bullets before advancing state.

## Files Changed This Session

- `.github/workflows/scotus-tracker.yml` — trimmed dead enrich step + orphans
- `supabase/migrations/20260412000000_pipeline_skips.sql` — NEW
- `scripts/lib/skip-reasons.js` — NEW
- ADO-473 created (parent ADO-467)
- ADO-466 Description + AC reformatted cleaner HTML (earlier in session)
