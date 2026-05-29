# Handoff: Claude Pardons Agent Planning (ADO-516)

**Date:** 2026-05-28
**Branch:** test (commit 938eddc)
**ADO:** Epic 516, Stories 518-523

## What Was Done

Created the full planning package for replacing the Perplexity+GPT pardons enrichment pipeline with a Claude Code cloud scheduled agent:

1. **PRD** at `docs/features/pardons-claude-agent/prd.md` — problem statement (116/118 empty crime_description, 40% L1 flatline), solution architecture, success criteria, cost analysis
2. **ADO Epic + 6 Stories** — mirrors SCOTUS (467) and EO (476) pattern exactly
3. **Technical Plan** at `docs/features/pardons-claude-agent/plan.md` — Codex-ready with exact files, migrations, build sequence, column governance

## Two-Pass Review Findings (All Fixed)

**Critical (fixed in plan):**
- RLS must be enabled on `pardons_enrichment_log` (matching 090/091)
- `pardons_skipped` column was missing from log table
- `admin-update-pardon` edge function validates corruption_level as 1-5 (needs 0-5)
- `admin-update-pardon` VALID_CONNECTION_TYPES missing 3 types from migration 062
- `receipts_timeline` and `source_urls` are NOT NULL — agent must send `[]` not `null`
- `prompt_version`, `enrichment_prompt_version`, `enrichment_meta` were missing from WRITES list

## ADO Structure

| ADO | Title | State |
|-----|-------|-------|
| 516 | Claude Pardons Agent (Epic) | New |
| 518 | S1: Observability Table | New |
| 519 | S2: Prompt & Gold Set Validation | New |
| 520 | S3: Cloud Trigger & TEST Validation | New |
| 521 | S4: Admin Tab Updates (edge function fixes) | New |
| 522 | S5: PROD Launch & Re-Enrichment | New |
| 523 | S6: Retire Legacy Scripts | New |

## Next Session

1. **Start at S1 (ADO-518):** Create `migrations/094_pardons_enrichment_log.sql`, apply to TEST
2. **Then S2 (ADO-519):** Write `prompt-v1.md` with 5-pardon gold set — verify gold set IDs against PROD
3. **PR #94 still open** — Josh needs to merge (auto-publish fix, all checks pass, mergeable). Required before S5 (PROD deploy).

## Key Discoveries

- `crime_description` admin editing already works (no new code needed for S4)
- S4 scope is now two edge function validation bugs only
- TEST has 94 pardons (PROD ~118), 89/94 have null crime_description
- Agent schedule: 20:00 UTC daily (2hrs after DOJ scraper at 18:00 UTC)
- Estimated 4-5 sessions to complete all 6 stories
