# ADO-478 — EO Claude Agent: Prompt v1 + Gold Set

**Date:** 2026-04-15
**Branch:** test
**Parent epic:** ADO-476 (EO Claude Agent)
**Session goal:** Write the EO enrichment agent prompt and manually author the 5-EO gold set. No TEST trigger this session — that's ADO-479.
**Session outcome:** Prompt + gold set complete. AC 1-5 MET. AC 6-7 BLOCKED on ADO-479. State remains Active.

## What was built

**New file:** `docs/features/eo-claude-agent/prompt-v1.md` — 871 lines, mirrors the SCOTUS agent prompt (`docs/features/scotus-claude-agent/prompt-v1.md`) structure section-by-section.

Structure:
1. Environment setup
2. Supabase PostgREST reference (Bash/curl, temp-file JSON body pattern)
3. Workflow — 7 steps from run start through per-EO log completion
4. Brand Voice "The Power Grab" (level 0-5 calibration, banned openings, hard-banned phrases)
5. Gold Set — 5 EOs across levels 1-5
6. Failure handling
7. Security
8. Invariants (16 rules that can never be violated)
9. Prompt metadata

### Gold set picks

| EO # | Title | DB alarm_level | Gold truth | Calibration purpose |
|------|-------|:-:|:-:|---|
| 14349 | LIRR Emergency Board | 4 | **1** | Anti-default-bias on the low end — routine Railway Labor Act procedure |
| 14338 | Improving Our Nation Through Better Design | 4 | **2** | Symbolic/cosmetic — federal architecture mandate, no policy substance |
| 14330 | Democratizing Access to Alternative Assets for 401(k) Investors | 4 | **3** | Corporate giveaway with real named beneficiaries (Blackstone, KKR, Apollo, BlackRock, Larry Fink) |
| 14343 | Further Exclusions From the Federal Labor-Management Relations Program | 4 | **4** | Named victim class (~200K federal workers) + named affected unions (AFGE, NTEU, NFFE) |
| 14317 | Creating Schedule G in the Excepted Service | 5 | **5** | Structural rewiring of civil service — Schedule F successor |

Legacy pipeline rated 4 of the 5 at level 4, including the genuinely routine LIRR procedure. That's the anti-default-bias story in one table.

## Why this shape — context from the 25-EO audit

The legacy GPT-4o-mini EO pipeline (`scripts/enrichment/prompts/executive-orders.js`) produced three documented failure modes over a 25-EO audit (2026-04-14):

1. **88% level-4 saturation.** Everything that wasn't obviously level 5 defaulted to 4. Routine procedural actions and structural power grabs were indistinguishable in the output.
2. **Fabricated cronyism.** 0 of 25 EOs named a real beneficiary — the model invented generic "donors" and "corporate interests" when the order text gave no such specifics.
3. **Clichéd phrasing.** "Dangerous precedent" appeared in 76%; "under the guise of" in 52%.

The v1 prompt hard-codes countermeasures for each:

- **Anti-default-bias:** Step 4 rule 1 says "Start `alarm_level` at 2. Earn every upgrade with specific evidence." Section 4 adds an 80/20 distribution quota (50% level 2-3, 25% level 4, 15% level 0-1, 10% level 5) and the meta-check "If your first three EOs all come out at level 4, STOP."
- **Named-actor rule** (Step 4 rule 2): `section_what_it_means` MUST contain either a specific named actor tied to concrete harm or benefit, OR the exact sentence *"No specific beneficiary is identifiable from the order text or signing statement."* The rule explicitly rejects bare agency acronyms — "DHS will implement" does not count. You need the winner or loser, not just the office doing the paperwork.
- **Hard-banned phrases:** `dangerous precedent` and `under the guise of` cannot appear anywhere in editorial fields. Plus the 27 banned openings from `public/shared/tone-system.json` plus section-specific banned starters from the legacy pipeline (ADO-273 list).

## Two-pass code review

**Pass 1 — `feature-dev:code-reviewer`:** Flagged `enrichment_meta` and `spicy_summary` as "referenced but nonexistent columns." Verification query to the TEST DB showed both columns DO exist (legacy migrations 070 and `add_spicy_summaries_columns.sql` respectively). False positives. Non-blocking cleanup applied — removed `spicy_summary` references from Section 4 since the agent does not write to it.

**Pass 2 — `superpowers:code-reviewer`:** Found 3 real criticals:

1. **Gold Example 1 used "...from the order text" instead of the exact mandated sentence** "...from the order text or signing statement." Pattern-matching behavior from the agent would have reproduced the shorter form. Fixed.
2. **`prevent_enriched_at_update` trigger (migration 023) not addressed.** The trigger rejects any update to `enriched_at` unless `prompt_version` strictly increases. On re-enrichment with the same `prompt_version`, the PATCH would silently return `[]` and cause a hard-to-debug failure. Fixed — Step 2 now documents the trigger, and the filter `or=(enriched_at.is.null, prompt_version.is.null, prompt_version.neq.v1)` already avoids triggering it.
3. **Concurrency race on run start.** Per-EO log schema (`eo_id NOT NULL`) prevents a run-level sentinel row, so two agents starting within a sub-second window can both proceed past Step 1.5's concurrent-run check. Can't be fixed without a schema change. Documented as an accepted v1 limitation — in daily-cron operation it's effectively impossible, and the `prevent_enriched_at_update` trigger turns any collision into a failed log row rather than data corruption.

Important findings also applied:
- Named-actor rule tightened (bare agency acronyms rejected)
- Federal Register 500-char threshold for placeholder/paywall detection
- Signing statement precedence rule (order text controls legal mechanism; signing statement rhetoric goes to `section_reality_check`)
- `jq` → `grep` fallback for log-row ID parsing
- `severity_rating` added to Step 5 checklist + Invariant 15 (always written alongside `alarm_level` with 0-1→null, 2→low, 3→medium, 4→high, 5→critical mapping)
- Level 0 policy: auto-flag `needs_manual_review = true` (no gold example for this level; human confirms)

## Acceptance criteria verification

| AC | Status | Notes |
|----|:-:|-------|
| 1. Prompt file created at `docs/features/eo-claude-agent/prompt-v1.md` | ✅ MET | 871 lines |
| 2. References `tone-system.json` ("The Power Grab", levels 0-5, 27 banned openings) | ✅ MET | Section 4 cites file explicitly; full calibration table; all 27 openings listed verbatim |
| 3. Mandates named actor OR "no specific beneficiary identifiable" | ✅ MET | Step 4 rule 2 + Invariant 13; exact sentence required; agency acronym alone rejected |
| 4. Hard-bans "dangerous precedent" + "under the guise of" | ✅ MET | Step 4 rule 3, Section 4 Hard-Banned Phrases, Invariant 3 |
| 5. 5-EO gold set at levels 2, 3, 4, 5 | ✅ MET | Actually levels 1-5 (bonus level 1 for anti-default-bias showcase) |
| 6. Agent run against gold set produces ±1 alarm match on 5/5, named actor on ≥4/5, zero banned phrases | ⏸ BLOCKED | Requires ADO-479 trigger |
| 7. `validation-v1.md` documenting the agent run | ⏸ BLOCKED | Downstream of AC 6 |

**State decision:** Remaining in Active per the hard-gate rule (no state change with unmet AC). Moves to Testing after ADO-479's trigger delivers a successful gold-set validation run.

## What's next

**ADO-479** — Create TEST cloud trigger for the EO enrichment agent. The trigger reads `prompt-v1.md` from the test branch on wake-up. First run will process the 5-EO gold set. Results → `docs/features/eo-claude-agent/validation-v1.md` → ADO-478 AC 6-7 verified → ADO-478 moves to Testing → Ready for Prod → Closed.

Then:
- ADO-480: Admin dashboard EO tab (review + publish UI, mirrors SCOTUS admin)
- ADO-481: PROD launch + backlog re-enrichment of ~285 EOs
- ADO-482: Retire legacy EO scripts (`enrich-executive-orders.js`, prompts, style patterns)

## Files touched

- `docs/features/eo-claude-agent/prompt-v1.md` — new, 871 lines
- `docs/features/eo-claude-agent/validation-results/` — empty folder created for ADO-479 session

## Cost note

$0 this session (documentation only). Cloud agent runs are $0 marginal under the Anthropic subscription. When the epic closes (ADO-482 retires the legacy pipeline), net monthly savings ~$5-10 on OpenAI calls.

## Verification steps for next session

Before starting ADO-479:

1. Confirm ADO-478 is still Active via `/ado`
2. Read `docs/features/eo-claude-agent/prompt-v1.md` — especially Section 3 Step 3A (log row INSERT template) and Section 4 (anti-default-bias rules) — the trigger prompt will reference these by file path
3. Read `docs/features/scotus-claude-agent/plan.md` for the TRIGGER API pattern that ADO-479 will mirror (two-step create-then-update, prompt in `job_config.ccr.events[].data.message.content`, model in `session_context.model`)
4. Check memory-project entity `scotus-claude-agent` for the exact TRIGGER config that worked for SCOTUS — same env vars, same bootstrap pattern, model = `claude-opus-4-6`
