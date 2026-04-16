# ADO-466 Session 2: Silent Skip Visibility — Instrumentation + Admin Card + Retention

**Date:** 2026-04-13
**Ticket:** ADO-466 (Active — awaiting product decision on unit tests before advancing)
**Branch:** test (pushed)
**Commit:** ed7af43

## What Was Done

Completed Step 2 of ADO-466 end-to-end: 10 silent-skip call sites now record to `pipeline_skips`, admin dashboard surfaces them, daily retention cron caps table size.

### Instrumentation (10 sites across 5 files)

All sites import `{ recordSkip, PIPELINES, REASONS }` from `scripts/lib/skip-reasons.js` and call `recordSkip(supabase, {...})` before the `continue`/`return`/`throw`.

| File | Sites | What |
|------|-------|------|
| `scripts/rss-tracker-supabase.js` | 4 | Embeddings: invalid response / DB update failed / API exception; Entity extraction: budget cap |
| `scripts/rss/fetch_feed.js` | 1 | Freshness filter drops (high-volume — see note below) |
| `scripts/enrichment/enrich-stories-inline.js` | 1 | Story enrichment with no articles |
| `scripts/aggregate-story-entities.js` | 2 | Empty article list, no entities found |
| `scripts/enrichment/extract-article-entities-inline.js` | 2 | JSON parse error, API error |

**Signature change:** `extractArticleEntities()` now takes optional `{supabase, articleId}` in a 4th options arg. Backward-compat with archive backfill caller (passes 3 positional args; options defaults to `{}`).

### Admin dashboard

- **`public/admin.html`:** New `SkipsTab` component with:
  - Time range toggle (24h / 7d / 30d)
  - Pipeline + reason filters (click any item to filter down)
  - Summary: counts grouped by pipeline → reason chips
  - Recent rows table with entity, metadata (JSON), timestamp
- **`supabase/functions/admin-pipeline-skips/index.ts`** (NEW, deployed to TEST):
  - POST endpoint, body: `{hours, limit, pipeline, reason}`
  - Admin password auth (same pattern as other admin-* functions)
  - In-memory aggregation up to 100k rows
  - Returns `{time_range_hours, total_count, truncated, by_pipeline, recent_rows, timestamp}`

### Retention

`.github/workflows/pipeline-skips-cleanup.yml` (NEW):
- Daily 4AM UTC cron
- PROD-gated (`github.ref == 'refs/heads/main' && vars.ENABLE_PROD_SCHEDULES == 'true'`)
- Deletes rows older than 30 days via PostgREST DELETE
- `workflow_dispatch` override for custom retention window

### Docs + housekeeping

- `CLAUDE.md` anti-pattern added: "silent skips without DB record" — references `recordSkip()` with usage snippet
- `scripts/lib/skip-reasons.js` converted from CommonJS → ESM (project default is `type:module`); added defensive `supabase.from` check
- `.github/workflows/scotus-tracker.yml` — removed dead budget guard step (prior code review flagged: now gates nothing and exits 1 on DB hiccup)

## Key Decisions (and WHY)

1. **Edge function POST + body, not GET + query string.** Code review surfaced that `supabase.functions.invoke` treats the function name verbatim — query strings get percent-encoded into the path. Fix: send params as JSON body on POST. Edge function accepts either body or query string for flexibility, body wins.
2. **Freshness filter instrumentation stays despite high volume.** `fetch_feed.js:442` gets re-hit on every 2-hour run for every out-of-window article still in the feed. Volume: ~1000 rows/day × 30-day retention = ~30K rows at steady state. Edge function aggregation cap bumped 10k → 100k to absorb. Future optimization: batch to one row per (feed, run) with count in metadata — not blocking.
3. **`recordSkip()` never throws.** Insert failures are swallowed with a `console.warn`. Skip-logging must not break the pipeline it's observing.
4. **Unit tests deferred pending Josh decision.** AC #6 requires unit/integration tests for HIGH severity skip paths. Card comment presents two options: accept integration verification via admin UI (recommended — simple helper, meaningful end-to-end coverage) or require unit tests (next session, ~1-2hrs). Stays in Active until answered.

## Code Review Results (feature-dev:code-reviewer)

**Verdict:** NEEDS-FIX → 2 issues → both fixed in this commit.

1. **CRITICAL:** `supabase.functions.invoke(`admin-pipeline-skips?hours=24...`, ...)` — query string in name would 404. Fixed: switched to POST with body.
2. **IMPORTANT:** freshness filter re-records same URL every 2h run; hundreds of duplicate rows could blow past the 10k aggregation cap in days. Fixed: bumped cap to 100k + documented future batching optimization.

Passing without concern: call-site placement (all before `continue`/`return`/`throw`), constants usage (no inline strings), `extractArticleEntities` backward-compat, edge function security, React/effect correctness, cleanup workflow Bash quoting, CLAUDE.md import path example.

## QA

- `npm run qa:smoke` — all 4 tests pass
- End-to-end JS helper test: 3 rows written with correct pipeline/reason, aggregation returns correct groupings
- Edge function deployed to TEST successfully

## What's Next

**ADO-466 is in Testing.** All 7 AC met. End-to-end verified on TEST.

**For PROD deployment (next session):**
1. Apply migration `20260412000000_pipeline_skips.sql` to PROD (Supabase Dashboard SQL Editor → PROD project `osjbulmltfpcoldydexg`)
2. Deploy edge function: `npx supabase functions deploy admin-pipeline-skips --project-ref osjbulmltfpcoldydexg`
3. Cherry-pick all 7 ADO-466 commits from `test` to a deployment branch off `main`:
   - `c2e28f2` chore(scotus) workflow trim
   - `306b80c` schema + helper
   - `32bcf36` JSDoc fix
   - `ed7af43` instrumentation + admin card
   - `8dc966f` unit tests
   - `f5f702c` UX explanations
   - `402c994` Skips → Failures rename
4. PR to main, code review (Codex), merge → auto-deploys frontend
5. Verify: trigger PROD RSS run, check admin → Failures tab

**Low priority follow-ups (separate cards worth considering):**
- Batch fetch_feed.js freshness skips to one row per (feed, run) — 200+ rows per RSS run is noisy
- Pipeline/reason CHECK constraints once stable (trade-off: migration vs typo safety via shared constants)
- PM-grade health view: anomaly detection vs baseline, status badge, hide routine noise (current view is developer-grade)
- Latent bug in `fetch_feed.js:106` `normalizePublishedAt`: `toStr(undefined)` returns `''` so `??` chain doesn't fall through. Items missing `isoDate` fall back to NOW instead of `pubDate`.

## UX iterations after initial verification

After the first end-to-end verification (RSS run produced 200+ freshness_filter rows), Josh flagged the card as confusing — no idea what skips meant, nothing to do. Two follow-up commits:

- **f5f702c** — Inline "What is this?" blurb, `REASON_COPY` map with what/volume/action for all 9 (pipeline, reason) pairs, tooltips on reason chips, contextual info panel when reason filter selected.
- **402c994** — Renamed tab Skips → Failures, moved to end of tab list (after disabled Exec Orders + Feeds). Card title "Pipeline Failures". Internal names (`pipeline_skips` table, `admin-pipeline-skips` function, `recordSkip`) unchanged — only user-facing copy.

Honest assessment: this is developer-grade observability. For true PM utility we'd need a redesign (anomaly highlighting, status badge, hide routine volume).

## Files Changed

Committed (ed7af43):
- `.github/workflows/pipeline-skips-cleanup.yml` — NEW
- `.github/workflows/scotus-tracker.yml` — budget guard removed
- `CLAUDE.md` — anti-pattern
- `public/admin.html` — SkipsTab + tab entry + conditional
- `scripts/aggregate-story-entities.js` — 2 sites
- `scripts/enrichment/enrich-stories-inline.js` — 1 site
- `scripts/enrichment/extract-article-entities-inline.js` — 2 sites + signature
- `scripts/lib/skip-reasons.js` — ESM + supabase guard
- `scripts/rss-tracker-supabase.js` — 4 sites + caller updated
- `scripts/rss/fetch_feed.js` — 1 site + volume comment
- `supabase/functions/admin-pipeline-skips/index.ts` — NEW

Not committed (out of scope, pre-existing uncommitted changes):
- `docs/features/scotus-qa/gold-set-changelog.json`, `tests/scotus-gold-truth.json`, `supabase/.temp/cli-latest` — from prior sessions, left alone
