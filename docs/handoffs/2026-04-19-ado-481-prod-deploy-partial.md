# ADO-481 PROD Deploy — Partial (Re-enrichment Deferred)

**Date:** 2026-04-19
**State:** Active (admin UI live, backlog re-enrichment pending)
**PR:** #86 (merged as `2f91daa`), #85 closed with explanation

## What Shipped to PROD Today

| Component | State |
|---|---|
| Migration 091 (`executive_orders_enrichment_log` table, VARCHAR(50) FK) | ✅ Applied |
| Migration 092 (`is_public`, `needs_manual_review`, triggers, indexes) | ✅ Applied |
| `admin-executive-orders` edge function | ✅ Deployed |
| `admin-update-executive-orders` edge function | ✅ Deployed |
| `admin-stats` edge function (EO counts added) | ✅ Updated (v9) |
| `public/admin.html` EO tab | ✅ Live on trumpytracker.com/admin.html |

All 251 existing EOs are `is_public=true`, `needs_manual_review=false` (backfill worked). Admin can visit the EO tab right now.

## What's Pending (Next Session)

### 1. Re-enrich 251 Backlog EOs

PROD EO state:
- **177 rows at `prompt_version='v1'`** — from the OLD GPT-4o-mini pipeline, not the Claude agent
- **74 rows at `prompt_version='v4-ado273'`** — intermediate attempt, same quality issues

Both sets suffer from the audit-documented problems (88% level-4 saturation, 'dangerous precedent' in 76%, fabricated cronyism, 0/25 named real beneficiaries).

**⚠️ Prompt version string collision:** The Claude agent also writes `prompt_version='v1'`. Cannot distinguish old-v1 GPT output from new-v1 Claude output by version alone. Consider bumping to `claude-v1` or `v2` next session to prevent ambiguity going forward.

### 2. Create PROD Cloud Trigger

No daily cron yet. Mirror SCOTUS PROD pattern:
- TTracker PROD env (`env_018AS3Shj6wkH624v1nkssG9` or equivalent)
- Model: `claude-opus-4-6`
- Bootstrap: git fetch origin main + checkout, read `docs/features/eo-claude-agent/prompt-v1.md`
- Schedule: `0 16 * * 1-5` (4PM UTC weekdays)

### 3. Decision Point — Re-enrichment Method

Josh's end-of-session question: *"can we have scheduled tasks run a few times and pick up where it leaves off?"*

Three options:

| Approach | Throughput | Quota | Cost |
|---|---|---|---|
| **In-session Claude** | All 251 in ~2-3 hrs context burn, one session | Zero trigger quota | Subscription time |
| **Cloud agent manual triggers** | 1-4 EOs/run, need ~60-100 runs | Heavy daily trigger budget | $0 marginal |
| **Cloud agent daily cron** | 1-4 EOs/run, ~100 days to drain | Sustainable | $0 marginal |

Josh's question implies the manual-triggers approach. The cloud agent is idempotent (skips already-v1 rows via the lock trigger), so it can pick up where it leaves off without special bookkeeping. But if we keep `prompt_version='v1'` on both old and new, the agent won't know which ones need re-enrichment — need to either bump the version string or manually set `prompt_version=NULL` on the 251 rows to re-queue them.

## Key Commits (on `main` via PR #86)

- `1faa97d` migration 091 (ADO-477)
- `73bee6c` ADO-477 code review (RLS + legacy copy)
- `8705624` prompt v1 + gold set (ADO-478)
- `e406c10` validation files (ADO-479)
- `4a7af17` admin tab + migration 092 (ADO-480)
- `18f0665` ID-agnostic refactor (ADO-481)
- `f2d660a` Codex P1 fixes (idempotency + console.log)
- `7c1fb02` Search injection guard + null filter removal
- `344f841` Two-phase cursor pagination
- `c480be5` + `33c25b6` Bridge cursor + bulk-publish id coercion

## Architecture Notes Worth Remembering

1. **IDs are opaque strings across the EO admin stack.** `parseId()` accepts number or string, validates via `/^[A-Za-z0-9_-]{1,50}$/`. Works on PROD VARCHAR(50) and TEST INTEGER.

2. **Two-phase cursor pagination** for nullable sort columns (alarm_level, enriched_at):
   - Phase 1: keyset on non-NULL value range, excludes NULLs
   - Phase 2: `.is(col, null)` + id keyset
   - **BRIDGE cursor** (empty id + NULL_SENTINEL val): emitted when Phase-1 exhausts with NULLs still in scope. Phase-2 filter skips id keyset on bridge.

3. **Search filter grammar injection guard:** `SEARCH_FORBIDDEN_RE = /[,()"\`\\]/` + 200-char cap. Rejects characters that could break out of PostgREST `.or()` string grammar.

4. **Accepted tech debt:** `is_public` is client-enforced only (no RLS policy). Follow-up ticket planned.

5. **Migration 092 re-run-safe:** Removed the `UPDATE … WHERE is_public IS DISTINCT FROM true` that would have republished admin-unpublished rows on replay. `ADD COLUMN IF NOT EXISTS … DEFAULT true` handles first-apply backfill.

## Verification Already Done

- 33/33 unit tests pass (pure-JS mirrors of edge function helpers)
- Two-pass internal review (feature-dev + superpowers) run twice — all Critical/Important findings addressed
- Codex AI review rounds 1-3 — 7 P0/P1 findings, all addressed
- Edge functions live-tested on TEST (INTEGER ids)
- Migrations applied to PROD, verification query shows expected state (251/251 public, 0 flagged)

## What's NOT Verified

- Live admin UI test on PROD (Josh hasn't visually verified the EO tab on trumpytracker.com yet)
- Re-enrichment pipeline end-to-end on PROD (depends on decisions in next session)
- No PROD cloud trigger exists yet — no automatic enrichment running
