# 2026-08-19 — ADO-551: SCOTUS disposition normalization (overnight autonomous run)

**Ticket:** ADO-551 (User Story, moved to Testing)
**Branch:** test (pushed)
**Session mode:** fully autonomous overnight run (with ADO-550 in the same session)

## What was done

Built directly on the audit in ADO-551's newest comment (2026-08-19) — did NOT re-audit, per instruction.

1. **`src/lib/adapter.ts`** — new `DISPOSITION_LABELS` map + exported `formatDisposition(disposition, caseType)`.
   Replaces the naive first-letter-cap at the old line 350 that rendered "Reversed_and_remanded" on detail
   pages (the bug Josh saw). Context-aware labels for the stage-mixed values: `granted`/`denied` render as
   "Cert Granted/Denied" for `case_type=cert_stage` and "Application Granted/Denied" for `shadow_docket`.
   `gvr` renders "Granted, Vacated & Remanded (GVR)". Legacy `'GVR'` input still accepted until migration 109
   is applied. Unknown values humanize (underscores → spaces) instead of leaking snake_case.
2. **`migrations/109_scotus_disposition_gvr_normalize.sql`** — NOT APPLIED (DDL is Josh's). Single
   transaction with an explicit ACCESS EXCLUSIVE lock (Codex review fix): drops the 087 CHECK,
   `UPDATE ... SET disposition='gvr' WHERE disposition='GVR'` (PROD ids 1906, 2051; TEST has none), re-adds
   CHECK with `gvr` replacing `GVR`. Idempotent; a failure rolls the whole swap back. Apply order matters:
   migration BEFORE deploying 'gvr'-writing code to PROD (header comment spells it out).
3. **`public/admin.html`** — SCOTUS disposition dropdown value `GVR` → `gvr` (label unchanged).
4. **`supabase/functions/admin-update-scotus/index.ts`** — legacy `GVR` input is NORMALIZED to `gvr` before
   validation/persistence (Codex review fix — accepting both would have let `GVR` pass validation then fail
   the post-109 DB CHECK); VALID_DISPOSITIONS lists only `gvr`. **Edge function NOT redeployed** — after
   migration 109 is applied on TEST, deploy with:
   `supabase functions deploy admin-update-scotus --project-ref wnrjrywpcadwutfykflu`.
5. **`scripts/scotus/syllabus-extractor.js`** + its fixture test — emits `gvr` now (Scout is dormant: no
   workflow runs it, only its own test imports it).
6. **`docs/features/scotus-claude-agent/prompt-v1.md`** (agent allow-list, lines 236/251) +
   **`docs/reference/scotus-agent.md`** — `GVR` → `gvr`. Prompt change reaches the live PROD agent only after
   cherry-pick to main; migration 109 must be applied on PROD FIRST (deploy-order rule in memory).

## Deliberately NOT done

- **The 10 PROD null-disposition rows** (ids 1, 296–304, Jan-2020 backfill artifacts incl. duplicate
  "In re Raghubir" 297/298): untouched per audit. **Josh decides hide vs delete.**
- **The 5 PROD `other` rows:** legitimate per audit crosstab (4 shadow_docket + 1 procedural), left as-is.
- **`public/app.js` titleCase** (same snake_case bug): only used by `dashboard-legacy.html`, superseded page —
  skipped, not worth touching.
- **`docs/features/scotus-qa/gold-set-changelog.json`** mentions `GVR` in a historical inclusion-rule record —
  it is history, not consumed by code (only referenced in old handoffs), left unmodified.
- **TEST DML:** none needed — TEST has zero `GVR` rows (verified via supabase-test MCP). TEST's 5 bare
  `vacated` rows are already valid enum values (087 CHECK always allowed `vacated`), kept in the enum.

## Validation

- Two-pass inline review done by main session (subagents banned): pattern pass + production-readiness pass.
  Findings addressed inline (transition window handling in edge fn; idempotency of migration).
- `npx vitest run`: 121/121 passed (incl. 6 new `formatDisposition` tests + detail-meta label assertion).
- `node scripts/tests/scout-crosscheck-fixtures.mjs`: 20/20 passed.
- `npm run qa:smoke`: all suites green (boundaries, integration, idempotency, concurrency, silent-skips,
  eo-admin-unit, clustering-eval, judge-dryrun 122/122).

## To verify / for Josh (morning)

1. Apply `migrations/109_scotus_disposition_gvr_normalize.sql` on TEST (SQL Editor), verify
   `SELECT count(*) FROM scotus_cases WHERE disposition='GVR'` → 0. PROD apply happens at next PROD deploy,
   BEFORE cherry-picking this commit to main.
2. Deploy `admin-update-scotus` edge function to TEST (command above).
3. Decide: hide vs delete the 10 PROD null-disposition rows (they are `is_public=true` and render with no
   disposition today).
4. Spot-check a SCOTUS detail page on the TEST site: disposition should read "Reversed & Remanded" style,
   and a shadow-docket granted case should read "Application Granted".
