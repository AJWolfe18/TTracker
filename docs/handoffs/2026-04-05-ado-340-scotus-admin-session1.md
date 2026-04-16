# Handoff: ADO-340 SCOTUS Admin Tab — Session 1 (Backend)

**Date:** 2026-04-05
**Branch:** test
**Commit:** 3a14347
**ADO:** 340 (Active)

## What Was Done

### New Edge Functions (deployed to TEST)

**`supabase/functions/admin-scotus/index.ts`** (~210 lines)
- Paginated SCOTUS case list with cursor-based keyset pagination
- 8 filters: isPublic, term, enrichmentStatus, needsManualReview, qaStatus, caseType, impactLevel, search
- Deterministic sort tiebreakers (secondary ORDER BY id, nullsFirst: false)
- Search splits numeric (id.eq) vs text (case_name_short.ilike) — never mixed
- `available_terms` metadata from server-side DISTINCT query
- Separate `action: 'run_log'` mode for enrichment agent run history (last 10)

**`supabase/functions/admin-update-scotus/index.ts`** (~320 lines)
- 28-field whitelist with type validation mirroring DB constraints
- Publish gate: `enrichment_status` must be `'enriched'` (checked on current DB state only — blocks same-request override)
- Coupled workflows per AC: publish sets qa_status='approved', unpublish resets to 'pending_qa', reject requires reason + resets enrichment_status
- Bulk publish (max 50): per-case optimistic lock, returns published/skipped/failed
- Audit logging via `log_content_change` RPC (entity_type='scotus')

**`supabase/functions/admin-stats/index.ts`** (edited)
- Added `needs_manual_review` and `enrichment_status` to SCOTUS select
- Added `scotus.needs_review`, `scotus.pending` to stats
- Added `scotus_needs_review` to needs_attention breakdown

### Verification

15 backend tests passed via curl:
- List (happy path, filters, pagination), run log
- Auth (no password → 401, bad password → 401)
- Search (numeric ID, text name)
- Update (valid edit + revert, invalid enum → 400, missing case_id → 400)
- Publish gate (flagged case → 400, same-request bypass → 400)
- Reject (missing reason → 400)
- admin-stats (scotus.needs_review showing)

### Code Review (4 findings, all fixed)

1. **Critical:** `decided_at` cursor regex missing `$` end anchor — injection surface in `.or()`. Fixed.
2. **Important:** Search on `case_name` but cursor on `case_name_short` — changed search to `case_name_short`.
3. **Important:** Reject note check fell back to raw `updates` object — removed fallback.
4. **Important:** Publish gate bypass via same-request `enrichment_status` override — now blocks any request setting both fields.

## What's Next

### Session 2: Frontend (Steps 5-9 of plan)
- SCOTUS constants + CSS in admin.html
- EditScotusModal component (5 collapsible sections)
- ScotusTab component (sub-tabs, filters, table, bulk publish, reject, run log)
- Wire up tab routing
- Full browser testing on TEST

### Session 3: PROD Promotion (Step 10)
- Cherry-pick, PR to main, AI review, edge function deploy to PROD

## Key References

- **Plan:** `C:\Users\Josh\.claude\plans\twinkling-marinating-haven.md`
- **Pattern sources:** `admin-pardons/index.ts` (list), `admin-update-pardon/index.ts` (update)
- **Tone colors:** `public/shared/tone-system.json` (impact level badge colors)
- **Admin dashboard:** `public/admin.html` (3,549 lines — frontend changes go here)
