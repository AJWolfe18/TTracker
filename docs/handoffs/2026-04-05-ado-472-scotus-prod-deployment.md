# Handoff: SCOTUS Agent PROD Deployment Complete

**Date:** 2026-04-05
**Branch:** test (no code changes this session)
**ADO:** 472 (Closed), plus 14 other cards closed/removed

## What Was Done

### PROD Trigger Setup
- Created PROD trigger `trig_019eD3JTVeSajL4qTJJSC6tq` via RemoteTrigger API
- Environment: `env_018AS3Shj6wkH624v1nkssG9` (TTracker PROD)
- Bootstrap prompt reads `prompt-v1.md` from `main` branch
- Model: `claude-opus-4-6`
- Josh set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in PROD cloud environment

### Re-Enrichment (116 cases)
- Unpublished 54 old-pipeline published cases
- Reset 111 old-pipeline enriched cases to pending (+ 5 gold-set test cases)
- Ran 12 successful agent batches + 1 stalled run (cleaned up)
- **Result: 116/116 enriched with v1.1, 0 failures**
- All 116 published (`is_public = true`)

### Confidence Breakdown
- High: 95 cases (82%)
- Medium: 18 cases (15%)
- Low: 3 cases (3%)
- 18 cases flagged `needs_manual_review` — all shadow docket orders with inferred vote splits

### Daily Cron Enabled
- Schedule: `0 16 * * 1-5` (4PM UTC weekdays, 11AM Chicago)
- First scheduled run: Monday April 6, 2026

### Queue Cleanup
- 818 old 2020-term cases set to `enrichment_status = 'flagged'` — bulk CourtListener imports with no opinion text

### Feature Flag
- `scotus: true` already on main (PR #81, Feb 2026) — no change needed

### ADO Cleanup (15 cards updated)
**Closed (5):** 308, 429, 469, 470, 472
**Removed (10):** 392, 438, 440, 441, 444, 445, 446, 455, 456, 457

### Raw Backup
- `scotus-prod-backup-2026-04-04-raw.json` on Josh's Desktop (pre-enrichment snapshot of 116 cases)

## What's Next
1. **Daily operations:** Agent runs at 4PM UTC weekdays. Josh reviews with `/scotus-review latest` when new cases appear.
2. **Admin dashboard (ADO-340):** Go-live blocker removed, but dashboard still needed for review/publish workflow
3. **Events feature:** Schema rework per `docs/features/events-tracker/design.md`
4. **Old pipeline cleanup:** Old SCOTUS scripts in `scripts/scotus/` can be removed (ADO-441 was removed but code still exists)
