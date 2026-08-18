# 2026-08-17 — ADO-542: Pipeline failure triage + EO tracker null-id fix

## Why this session happened

Josh reported "pipeline issues today, maybe GitHub." Triage of GitHub Actions found **two
unrelated failures**, neither of which was GitHub:

1. **RSS Tracker - PROD** — 5 consecutive failures starting 16:16 UTC Aug 17.
   Cause: OpenAI account `credit_balance_exhausted`. Not a code bug. **Still open** —
   only Josh can add credits (platform.openai.com → Billing). Until then the RSS run
   fails every 2h at the enrichment step, and the **AI PR-review check also fails**
   (same OpenAI account) — that's why PR #114 merged with a red `review` check.
2. **Track Executive Orders** — failing daily since **Aug 6**, not just today
   (the Aug 5/10 "successes" were no-new-EO days). This became ADO-542.

## Root cause (ADO-542)

PR #110 (ADO-540, merged Aug 5) replaced `id: generateOrderId()` with a comment
assuming the DB auto-generates ids. True on TEST, false on PROD — **schema drift**:

- TEST `executive_orders.id` = INTEGER identity (auto-generates)
- PROD `executive_orders.id` = VARCHAR(50), NO default → every new-EO insert died
  with 23502 not-null violations. EOs 14417–14420 never reached PROD.

The drift was already documented in migration 091's header notes; nobody checked.

## The fix (PR #114, squash-merged to main; commits 025327c + 7cdf94a on test)

- **migrations/108_eo_id_default.sql** — gives PROD's id column
  `DEFAULT ('eo_' || gen_random_uuid())`. Type-guarded (`text` OR `character varying`)
  so it's a no-op on TEST. Applied by Josh in PROD SQL Editor, verified via
  `information_schema.columns.column_default`.
- **Script** — removed dead `generateOrderId()`, documented why id must NOT be set
  client-side (column types differ per env). Added `EO_LOOKBACK_DAYS` override,
  strictly validated (digits only, clamped 1–365).
- **Workflow** — `lookback_days` workflow_dispatch input for backfills.

### Codex review caught two real P1s (both fixed before merge)

1. **The migration's original `text`-only type guard was a silent no-op on PROD** —
   `information_schema` reports VARCHAR as `character varying`. Josh's *first* migration
   run did nothing; he had to re-run after the guard fix. Lesson: type-guarded DDL must
   account for varchar vs text.
2. Unvalidated `EO_LOOKBACK_DAYS` could throw on `toISOString()` (huge values → invalid
   Date), and the surrounding catch would silently fall back to a full import.

## Verification

- Live run against TEST DB: inserted 14417–14420 cleanly (also proved TEST auto-generates).
- Edge-case tests on lookback validation ("", "21", "999999999999", "21days", "0", "abc").
- `qa:eo-admin-unit` 35/35.
- Backfill run 32092789923 (`lookback_days=21`) succeeded on PROD; PostgREST query
  confirmed all 4 EOs present with `eo_<uuid>` ids.
- Enrichment of the 4 EOs is automatic via the EO Claude agent's daily cron — no action.

## Gotchas worth remembering

- **Local script runs**: scripts don't auto-load `.env`; need `set -a; . ./.env; set +a`
  plus `TARGET_ENV=test` and mapping `SUPABASE_ANON_KEY=$SUPABASE_TEST_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_TEST_SERVICE_KEY` (env-validation.js enforces
  URL-ref/env match, so a wrong mapping fails safe).
- A `supabase-prod` MCP server exists (project-scoped to osjbulmltfpcoldydexg) but needs
  a one-time OAuth authorization from Josh — flow was started, not completed. Would allow
  PROD SQL directly next time instead of pasting to Josh.
- ADO-542 description/comments hold the full evidence trail. Ticket Closed.

## State at session end

- ADO-542: **Closed** (fixed and verified on PROD).
- **OPEN: OpenAI credits** — RSS PROD enrichment down until Josh tops up.
- Next feature session: ADO-530 fronts — Josh answers PRD §12 open questions
  (Q2 "one front per story" gates migrations), then break Wave 1 into stories.
  See `docs/handoffs/2026-08-09-ado-530-fronts-prd.md`.
