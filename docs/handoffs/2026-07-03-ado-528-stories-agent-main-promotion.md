# Handoff: Stories Claude Agent — AC Closure, Anti-Batching Fix, Main Promotion

**Date:** 2026-07-03
**Branch:** test
**ADO:** 528 (Stories Claude Agent — replace GPT-4o-mini enrichment), state=Active. 529 (Clustering Quality Audit, new), state=Todo.

## What Was Done

This was a long session with two phases. Phase 1 closed out the remaining validation gaps from yesterday's Task 5. Phase 2 discovered and fixed a significant gap: none of this project's work had ever reached `main`.

### Phase 1: AC4/AC5 closure, anti-batching fix

- **Closed AC4 and AC5** (both unmet, blocking ticket advancement): scored a 9-story sample from the real 2026-07-02 40-story TEST run against the calibration ladder (9/9 PASS) instead of the plan's literal "sync 5 PROD gold IDs into TEST" step — documented as an explicit deviation in `docs/features/stories-claude-agent/validation-results/2026-07-03-task5-6-validation.md`. Verified programmatically across all 40 stories: severity/alarm_level mapping 100% consistent, category enum 100% valid, zero banned-phrase violations.
- **Fixed the batching deviation** flagged in yesterday's handoff: added an explicit "One Story at a Time" section to `prompt-v1.md`, plus reinforcement at Step 3 and a new invariant #17. Verified with a live re-run: 7 stories processed with real ~45-90s gaps between completions, not the ~1-2s clustering from before.
- **Created ADO-529** (Clustering Quality Audit, Todo): while scoping historical-backlog reprocessing, found PROD has ~12,088 active stories against ~17,210 articles (~1.4:1 ratio — very little multi-article merging happening). Explicitly scoped as a diagnostic-first investigation, not assumed to need the same fix as enrichment (clustering is a threshold/embedding problem, not an LLM reasoning problem).
- **Non-issue, worth noting so it isn't rediscovered:** PROD has zero `closed`/`archived` stories — the 72hr/1wk aging logic exists in `scripts/job-queue-worker.js` but that worker was superseded by the inline pipeline (TTRC-266) and never runs. Josh confirmed he doesn't want auto-closing anyway.
- **Unrelated quick fix, also promoted to PROD this session:** changed `::selection` text color from near-black to white (`src/styles/base.css`, `index.html`) for readability against the red highlight background. PR #102, merged.

### Phase 2: the main-promotion gap

Josh triggered the PROD `RemoteTrigger` I'd created earlier and got: *"Routine blocked — prompt file missing. The file `docs/features/stories-claude-agent/prompt-v1.md` does not exist anywhere in the repository."*

**Root cause:** this entire project (migration 098, the kill-switch code, the prompt, the gold set, all validation docs) was built across 4 sessions entirely on `test` and never promoted to `main`. The PROD trigger's bootstrap (`git fetch origin main && git reset --hard origin/main`) correctly couldn't find any of it. Also discovered: `scripts/rss-tracker-supabase.js` on `main` still unconditionally calls the legacy GPT enrichment — the kill-switch code was test-only too, so the `ENABLE_LEGACY_STORY_ENRICHMENT` repo variable had zero effect on PROD until this was fixed.

**Fixed via PR #103** (merged): brought the full `docs/features/stories-claude-agent/` directory, related handoffs, migration 098, the kill-switch code, and workflow YAML wiring to `main`. No behavior change on merge — the kill-switch defaults to off, so PROD's legacy enrichment kept running unchanged through the merge itself; it only pauses once the new schedule is turned on.

**Code review found real issues across 3 rounds, all fixed before merge:**
1. Added `migrations/099_stories_enrichment_log_hardening.sql` (a `duration_ms >= 0` CHECK, a unique index preventing duplicate per-run heartbeat rows, and a `run_id` lookup index) — first draft wasn't idempotent (violated this repo's own `IF NOT EXISTS` convention) and used `CREATE INDEX CONCURRENTLY`, which cannot run inside a transaction block. Fixed both across 3 review rounds.
2. `prompt-v1.md`'s `primary_actor` field example used the canonical entity-ID format (`ORG-ICE`) instead of the human-readable name the field's own spec requires — fixed to `"ICE"`. All 47 real TEST stories reviewed this session already used the correct format regardless, so this was a latent doc inconsistency, not an observed failure.

**Two-pass independent review at session end** (per `/end-work`, separate from the PR-level Codex reviews) caught one more real issue: migration 099's new heartbeat unique index could collide if two runs launch in the same second (manual trigger + cron, for example), since `RUN_ID` only had second-precision. **Fixed via PR #104** (merged): bumped to millisecond precision, with a scope note that this is safe because the prompt only ever runs inside Anthropic's Linux cloud container, never a local/macOS shell.

All fixes were applied to both `test` and the deploy branches, so `test` doesn't regress relative to what's now on `main`.

## Review / Verification

- Migration and prompt changes went through 3-4 rounds of independent GPT-5-based PR review each (via the repo's Codex integration), all findings verified against actual file content and either fixed or explicitly judged as false-positive/inapplicable with reasoning documented in commit messages
- Two additional independent subagent reviews run at session end (pattern/security pass + production-readiness pass) — found one real issue (RUN_ID collision), fixed and merged
- `npm run qa:smoke` passed before the main-promotion PR
- Verified precedent for every "security" finding judged as false-positive (the `${SUPABASE_SERVICE_ROLE_KEY}` env-var-reference pattern, trigger/environment IDs in docs, anon-key-from-JS-bundle phrasing) against already-merged EO/SCOTUS/Pardons docs on `main` before dismissing

## Next Session Should

1. **Confirm migrations 098 + 099 are applied to the PROD database.** Being merged into git is not the same as being applied — migrations here are run manually via the Supabase SQL Editor. This session had no PROD SQL execution access to verify (only read access to TEST via PostgREST; the general Supabase MCP connector isn't authorized for TTracker's PROD/TEST projects, and the OAuth-gated `supabase-prod` MCP server was flagged to Josh as requesting broader scopes than needed — he hasn't authorized it). If not yet applied, the SQL to run (in order) is in `migrations/098_stories_enrichment_log.sql` then `migrations/099_stories_enrichment_log_hardening.sql`.
2. **Get Josh's go-ahead, then run the PROD trigger** (`trig_0182WcUVyjF7Q5o2GWJMxbo1`) once for Task 7 Step 3's empirical legacy-exclusion check — this is the agent's first-ever write to production. Before running, identify 5-10 known-old GPT-enriched PROD stories (`enrichment_meta->>'model' = 'gpt-4o-mini'`, `last_enriched_at` well past 12h). After running, confirm none of them appear in `stories_enrichment_log` or got touched.
3. **If the exclusion check passes:** enable the PROD cron schedule (`30 */2 * * *`) via `RemoteTrigger action=update` on `trig_0182WcUVyjF7Q5o2GWJMxbo1`.
4. **Monitor first 3 days** per plan.md Task 7 Step 4.
5. Once stable, move ADO-528 through Testing → Ready for Prod → Closed (AC6 gates this). After 2 weeks clean, delete the retired GPT code path.
6. **Separately, ADO-529 (Todo)** is queued as the next major project: a diagnostic-first investigation into why PROD's article-to-story ratio is only ~1.4:1 (very little clustering/merging), explicitly not assumed to need the same architecture fix as enrichment.

## Starting Prompt for Tomorrow

```
/start-work Continue the Stories Claude Agent work (ADO-528, docs/features/stories-claude-agent/plan.md).
Main now has everything (PRs #103, #104 merged) - the earlier "prompt file missing" trigger error is
fixed. First step: confirm migrations 098 + 099 are actually applied to the PROD database (not just
merged in git), then get my go-ahead to run the PROD trigger (trig_0182WcUVyjF7Q5o2GWJMxbo1) once for
the Task 7 Step 3 legacy-exclusion check. If that passes, enable the 30 */2 * * * cron schedule and
start the 3-day PROD monitoring window. See docs/handoffs/2026-07-03-ado-528-stories-agent-main-promotion.md
for full detail.
```
