# Handoff: ADO-478/479 Closeout + ADO-480 Planning

**Date:** 2026-04-17
**Branch:** test
**Session outcome:** ADO-478 + ADO-479 moved to Ready for Prod; ADO-480 plan v3.3 complete and ready to build.

## What happened this session

### Part 1 — ADO-478/479 closeout

- **Verified EO Claude Agent gold set validation was legitimate.** Spot-checked EOs 14317 (L5 Schedule G), 14338 (L2 Architecture), 14349 (L1 LIRR) in TEST DB. Agent `section_*` fields match gold tone exactly. "They actually fucking did it." at L5, "executive branch cosplaying as an art school" at L2, "the boring part of government that usually works" at L1 — tone calibration working.
- **Investigated stale DB fields.** Legacy `spicy_summary`, `severity_label_inapp/share`, `shareable_hook`, `eo_impact_type` all still contain old GPT-pipeline level-4 saturation garbage. Confirmed via grep that public frontend does NOT render these fields — labels come from `tone-system.json` via `alarm_level` lookup at `public/eo-app.js:25-30` (hardcoded fallback) with runtime fetch at line 51. Stale DB fields are dead weight, scheduled for drop in ADO-481.
- **Frontend label architecture verified:** "Smoke and Mirrors" (Level 2 EO label) is correct and comes from `tone-system.json labels.eos.2.spicy`. Not stale, not cached — just the designed label.
- **Moved both tickets through states:** ADO-478 Active → Testing → Ready for Prod → Closed, then corrected to Ready for Prod (Closed = deployed to PROD per workflow; PROD deployment is ADO-481). ADO-479 Testing → Ready for Prod → Closed, corrected to Ready for Prod.

### Part 2 — ADO-480 planning

Created `docs/features/eo-claude-agent/ado-480-admin-tab-plan.md` for the admin EO tab work.

**Plan iterations:**
1. **v1** — naive "mirror SCOTUS" approach. Josh flagged 7 foundational issues (schema mismatch, JSONB contradiction, undefined state machine, etc.)
2. **v2** — addressed Josh's 7 issues; Josh flagged 3 more (unresolved decisions, undurable ack, severity_rating contradiction)
3. **v3** — baked in 6 decisions, added migration contract
4. **v3.1** — Josh flagged 3 more (run_log derivations missing, public-read gate incomplete, trigger SQL didn't match contract)
5. **v3.2** — passed through superpowers code-reviewer agent, found 5 BLOCKERS + 9 IMPORTANT items, all resolved
6. **v3.3 final** — captured Josh's accepted-tech-debt sign-off on is_public client-gate

**Key technical findings that shaped the plan:**

- `docs/database/database-schema.md §executive_orders` is severely stale (lists 9 columns, actual table has ~50). Updating this is step 1 of the build.
- `executive_orders` has NO `is_public`, `enrichment_status`, `qa_status`, or `needs_manual_review` columns. Admin tab requires migration `092_eo_admin_publish_gate.sql` adding `is_public` + `needs_manual_review`.
- Existing `lock_enriched_at` trigger (migration 023) rejects `prompt_version` downgrades. Workaround: re-enrich sets `prompt_version=NULL, enriched_at=NULL` — NULL comparisons return NULL (not TRUE), trigger doesn't raise. **No trigger modification and no prompt update needed.**
- Sync trigger must also set `is_public=false` when it raises `needs_manual_review=true` — otherwise the "published + flagged" state becomes reachable via cron re-runs on published rows.
- `severity_rating` is always server-derived from `alarm_level` via new shared helper `supabase/functions/_shared/eo-severity.ts`.
- SCOTUS parity: auth is `x-admin-password` header (not body.password); bulk response shape is `{success, published[], skipped[], failed[], summary}`.

**Accepted technical debt (Josh sign-off 2026-04-17):** `is_public` is client-enforced only. No server RLS policy on `executive_orders` for anon role. Follow-up ticket — **not a build blocker**.

## What's in the plan

§0 header, §1 schema reality + full column inventory, §2 acknowledgment model, §3 six decisions log, §4 contracts (predicates, state machine, concurrency, latest-log tiebreaker, pagination, edge function I/O, migration SQL with three triggers), §5 build sequence + editable allowlist + modal structure + row actions, §6 contract + unit + manual tests, §7 risks, §8 out of scope, §9 definition of done.

## What's next

ADO-480 is still at **New**. Next session:

1. Read `memory-global` + `memory-project`
2. Open `docs/features/eo-claude-agent/ado-480-admin-tab-plan.md`
3. Move ADO-480 to Active via `/ado`
4. Execute §5.1 build sequence (15 steps). Fits one focused session per SCOTUS precedent.

**Don't let this bite you:**

- Build sequence step 3 (migration) MUST happen before step 5-8 (edge function deploys) — edge functions read `needs_manual_review` which doesn't exist until migration runs
- Build sequence step 9 (frontend `is_public=eq.true` filter on `public/eo-app.js:674`) MUST ship in same PR as migration — without it, the publish gate is no-op on the public site
- Don't copy-paste SCOTUS sort parser; use `lastIndexOf('-')` not `split('-')` for underscored sort keys
- `severity_rating` goes in server-side helper, NOT as a DB generated column (drift risk with agent's internal mapping)

## Files touched

Net new: `docs/features/eo-claude-agent/ado-480-admin-tab-plan.md`
No code changes. No migrations applied.

## ADO state at session end

- ADO-478 — Ready for Prod (EO prompt + gold set validation)
- ADO-479 — Ready for Prod (TEST cloud trigger, `trig_01KZtMsTTcxteiDDDNrCRCXt`)
- ADO-480 — New (plan complete, ready to build)
- ADO-481 — New (PROD deploy + backfill re-enrichment of ~285 EOs)
- ADO-482 — New (retire legacy EO scripts)
