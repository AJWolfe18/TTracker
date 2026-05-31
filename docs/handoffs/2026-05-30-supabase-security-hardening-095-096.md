# Handoff: Supabase Security Advisor Hardening (migrations 095 + 096)

**Date:** 2026-05-30
**ADO:** 525 (deferred undo lockdown), 526 (096 PROD-hardening)
**PRs:** #96 (095), #98 (096) — both open to `main`, **need merge**
**Status:** DB changes applied + verified on **TEST and PROD**. Advisor all-clear achieved (see below).

## What & why
The Supabase security advisor flagged ~20 SECURITY warnings on TEST (later, more on PROD). Investigation
of the migrations + calling code showed the real issues were `SECURITY DEFINER` RPCs callable by `anon`
(because `CREATE FUNCTION` grants `EXECUTE` to `PUBLIC` by default and migration `083` never revoked it),
plus mutable `search_path` on 9 functions. PROD had **drifted** from TEST and carried extra exposures.

## Migration 095 (`migrations/095_security_hardening_rpcs.sql`)
- Revoked `PUBLIC`/`anon`/`authenticated` EXECUTE on `log_content_change`, `log_admin_action`, and the
  **14-arg** `upsert_article_and_enqueue_jobs`; granted `service_role`.
- Set `search_path = pg_catalog, public, extensions` on the 9 advisor-flagged functions.
- Implemented as an idempotent by-name+`pronargs` `DO`-block (`oid::regprocedure`) — robust to the two
  `upsert` overloads and paste-safe (hardcoded long type signatures caused a `type "t" does not exist`
  truncation error in the SQL Editor; the DO-block avoids it).

## Migration 096 (`migrations/096_prod_security_drift.sql`)
- **Part A:** locked `claim_next_job`, `reset_failed_jobs`, and the **10-arg** `upsert` (service_role-only
  callers, confirmed in code) — revoke PUBLIC/anon/authenticated, grant service_role.
- **Part B:** dropped 9 dead `{public}` always-true write RLS policies on `executive_orders`,
  `political_entries`, `pending_submissions`. **Confirmed NOT exploitable**: anon/authenticated hold no
  INSERT/UPDATE/DELETE table grant (RLS on), and `service_role` bypasses RLS. Kept all SELECT/read
  policies, the `service_role full access` policies, and the conditional `pending_submissions` policy.

## Verification (live)
- TEST + PROD: `has_function_privilege` shows `anon=f, authenticated=f, service_role=t` for every locked
  function (both upsert overloads). `undo_content_change` intentionally still `anon=t` (deferred).
- PROD `pg_policies`: only reads + service_role + the conditional policy remain.
- **Final PROD advisor** = only: 3× `extension_in_public` (accepted), `undo_content_change` anon/auth
  (deferred, ADO-525), `vulnerable_postgres_version` (one-click dashboard upgrade). All function-grant
  and RLS findings cleared.

## Deferred / next
- **ADO-525:** `undo_content_change` is still anon-callable by design — `admin.html` calls it directly
  with the anon key (~lines 1887/3050/3573) with no password gate. Proper fix: new password-gated edge
  function (mirror `admin-update-story` + `checkAdminPassword`), rewire admin.html, then revoke anon.
- **Merge PRs #96 and #98** to main (code record; DB already applied to PROD).
- Accepted/no-action: 3 `public`-schema extensions (Supabase default, risky to move); Postgres patch
  (Settings → Infrastructure upgrade, PROD on 17.4.1.069).

## Gotchas (also in memory)
- Migrations are applied **manually via the Supabase SQL Editor** (or MCP), NOT `scripts/apply-migrations.js`
  (that only checks/repairs migration 009).
- `claude_ai_Supabase` MCP in this session was bound to a different org (`WhiskeyPal Test`) — could not
  reach TTracker; all SQL was run by Josh in the SQL Editor.
- Always re-run the advisor on **PROD separately** — it drifted from TEST.
