# Handoff: Stories Claude Agent — Plan Written & Reviewed

**Date:** 2026-06-30
**Branch:** test
**ADO:** 528 (Stories Claude Agent — replace GPT-4o-mini enrichment), state=New

## What Was Done

### 1. Daily verification pass (PROD)
Confirmed all PROD pipelines ran and auto-published correctly today, and that yesterday's two fixes are holding:
- **RSS/Stories:** 5 runs today, 70 new stories, all `status=active`, fully enriched, confirmed live via the actual `stories-active` edge function (not just raw table state).
- **SCOTUS:** 0 unpublished cases. Anon GRANT fix (fixed 2026-06-29) confirmed holding — queried `scotus_cases` directly with the public anon key extracted from the live production JS bundle.
- **Pardons:** 0 pending review, nothing new to process today.
- **EO:** description-column fix (PR #101, 2026-06-29) confirmed holding — EOs 14407-14413 all `is_public=true`, `prompt_version=v1.1`, `enriched_at` populated. One new EO (14414) correctly pending its next daily enrichment cycle (normal lag, not a bug).

### 2. Regression found (NOT fixed this session — flagged for next session)
While verifying the EO fix, discovered the **legacy GPT-4o-mini EO enrichment is still running on PROD** (`executive-orders-tracker.yml` → `scripts/executive-orders-tracker-supabase.js`), generating `spicy_summary`/`shareable_hook`/category via OpenAI on every new EO. This directly contradicts "we only use Claude for any of this" (Josh's words).

Root cause: **ADO-482** ("Retire legacy EO enrichment scripts," state=Testing) is misleadingly close to done. PR #89 merged and cleaned up `executive-orders-tracker.yml` (removed a concurrency block, renamed a step) — but **never touched `scripts/executive-orders-tracker-supabase.js` itself**. The actual raw-data-only rewrite of that script (ADO-271, commit `dc8912d` on `test`) was never cherry-picked to `main`.

New blocker discovered: deploying that script fix as-is will break, because it writes a `description` column that **doesn't exist on PROD's `executive_orders` table**. Needs `ALTER TABLE executive_orders ADD COLUMN IF NOT EXISTS description TEXT;` before/with the cherry-pick.

**Next session should:** reconcile ADO-482's actual remaining scope, add the migration, cherry-pick `dc8912d` (and any commits after it needed for `executive-orders-tracker-supabase.js`) to a deployment branch, PR to main.

### 3. Stories Claude Agent — full plan written and reviewed
Josh's core ask: "the quality of the ratings and the stories are shit" — investigate replacing GPT-4o-mini story enrichment with a Claude agent, same pattern as SCOTUS/EO/Pardons.

**Evidence gathered before writing the plan:** sampled the 200 most recent live stories — **67% rated alarm_level 4-5 ("severe"/"critical")**. This is the same saturation failure shape GPT-4o-mini produced on EO before that migration (88% level-4). No prior documented complaint existed in memory/ADO for Stories specifically; this session's measurement is what substantiated the decision to do a full replacement (Option A) rather than a cheaper QA-overlay (Option B, rejected — it's structurally the same "second LLM reviews the first LLM's output" pattern SCOTUS's own `qa-layer-b.js` proved unreliable and got explicitly retired, not kept).

**Plan doc:** `docs/features/stories-claude-agent/plan.md`

**Architecture summary:**
- Clustering stays inline, unchanged, every 2 hours (not the quality problem, needs to stay fast for freshness).
- Enrichment moves to a Claude Sonnet cloud agent, same 2-hour cadence, batches of up to 40 stories.
- Publish gating reuses the **existing** `stories-active` edge function gate (`summary_neutral IS NOT NULL`, TTRC-119) — no new column, no frontend change needed. This was a key research finding: the "hide until enriched" pattern Josh wanted already existed in the codebase, just wasn't being exploited by a decoupled enrichment step.
- Cost: nets ~$5.60/month **cheaper** (eliminates GPT-4o-mini spend, $0 marginal Claude cloud-agent cost — same subscription-included model as SCOTUS/EO/Pardons).
- Historical backlog reprocessing (relabeling the existing 67%-severe stories) is **explicitly deferred, out of scope** — Josh's decision this session. The query design makes this a natural follow-up (just null `last_enriched_at`/`enrichment_meta` on targeted rows) rather than something requiring special-casing later.

### 4. Three rounds of Codex review — all findings verified against actual code and fixed
Codex reviewed the plan directly (no PR needed, local review). Every finding was checked against the real codebase before fixing (per `superpowers:receiving-code-review` — no blind implementation):

**Round 1 (3 P1, 1 P2):**
1. RemoteTrigger API payload used the wrong shape (top-level `prompt`/`repositories`/`max_turns`) — real API (per SCOTUS's actual build history, `docs/handoffs/2026-04-03-ado-469-gold-set-validation.md`) requires `job_config.ccr.events[].data.message.content` + `session_context`. Fixed.
2. Candidate query gated on `summary_neutral.is.null` instead of `last_enriched_at`, dropped the `article_story!inner` join, and told the agent to never touch `enrichment_status`/`enrichment_failure_count` despite the admin dashboard depending on them. Fixed to match the real retry-storm-safe query and failure-write conventions already live in `rss-tracker-supabase.js` and `enrich-single-story.js`.
3. No instruction to use the canonical entity-ID system (`scripts/lib/entity-normalization.js`) — would have silently corrupted `top_entities`/`entity_counter`. Fixed — added as a required prompt read.
4. Rollback plan assumed a kill-switch env var that was never wired into either RSS workflow. Fixed — added explicit workflow-file diffs to Task 2.

**Round 2 (2 P1):**
1. The round-1 query fix (`last_enriched_at IS NULL OR stale`) had no way to distinguish "never enriched" from "GPT-enriched days ago" — would have swept the entire active backlog into the Claude agent on cutover, contradicting the "defer backlog reprocessing" decision. Fixed with an `enrichment_meta->>source = claude-agent` discriminator (and a matching failure-write marker, so retries still work).
2. TEST/PROD cloud-trigger bootstrap guidance directly contradicted itself (one line said the cached workspace needs a fetch/reset every run, the next said PROD could skip it). Fixed — both TEST and PROD require it, no exception.

**Round 3 (1 P1, 1 P2):**
1. The only concurrency guard was a coarse pre-check against a per-story log table — same race EO documents, but EO accepts it because a DB trigger (`prevent_enriched_at_update`) blocks the losing write. Stories has no such trigger, so a lost race would have silently overwritten content. Fixed with optimistic PATCH filtering (conditional write on the exact `last_enriched_at` value read) — a losing race now returns an empty response, which the prompt already treats as a write failure to log and skip.
2. Monitoring query would false-alert on healthy empty runs — Stories runs 12x/day vs. EO's 1x/day, so strings of zero-candidate cycles are normal, but the log table (mirroring EO) only gets rows when candidates are found. Fixed — made `story_id` nullable, agent writes a heartbeat row on 0-candidate runs.

## Key Gotchas / Reusable Patterns (also saved to memory `claude-agent-patterns`)

1. **RemoteTrigger's real API shape** is not what the SCOTUS plan.md originally drafted (that draft was written before the actual shape was discovered through trial and error). Use the verified shape from the round-1 fix above for any future Claude cloud agent.
2. **Optimistic PATCH filtering as a trigger substitute:** for any entity table without an EO-style `prevent_*_update` trigger, guard concurrent writes by filtering the PATCH on the exact value read at query time, not by adding a new DB trigger.
3. **Nullable FK + heartbeat row** for per-entity log tables on sub-daily-cadence agents — otherwise "no log rows" is ambiguous between "not running" and "found nothing to do."

## Verification

Everything in this handoff was verified against live PROD data and actual source files this session — direct PostgREST queries via the anon key extracted from the production JS bundle, `git diff origin/main origin/test` for the EO script gap, `gh pr diff --name-only` to confirm PR #89's actual file scope, and line-by-line codebase reads for every Codex finding before fixing (query logic in `rss-tracker-supabase.js`, entity normalization in `entity-normalization.js`, admin filters in `admin-stories/index.ts`, failure conventions in `enrich-single-story.js`).

## Next Session Should

1. **EO regression (higher priority, quick):** reconcile ADO-482 scope, add the `description` column migration, cherry-pick the ADO-271 script fix to main.
2. **Stories Claude Agent (larger, multi-session):** execute `docs/features/stories-claude-agent/plan.md` Tasks 1-4 (migration, kill switch, prompt authoring, gold-set curation) — no external blockers. Before Task 5, confirm the Cloud Environment exists in claude.ai/code (TEST Supabase URL + service key, Full network access) — Josh's action item, not yet confirmed done as of this session's end.
3. Kickoff prompt for a fresh session is already given to Josh (see this session's chat log) — points at the plan doc and the required `superpowers:subagent-driven-development`/`executing-plans` sub-skill.
