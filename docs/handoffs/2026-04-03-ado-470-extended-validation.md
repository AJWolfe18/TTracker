# Handoff: SCOTUS Claude Agent — Extended Validation (Task 5)

**Date:** 2026-04-03
**Branch:** test
**Commits:** fb53ef1 (JSON escaping fix), a4e848d (anti-default-bias + results)
**ADO:** 470 (Active)

## What Was Done

### Task 4: Fix JSON Escaping in Prompt
- Updated prompt-v1.md to use Write tool + `curl -d @file` pattern for all PATCH bodies
- Prevents apostrophes in opinion text from breaking shell quoting
- Added "JSON Body Construction" section in Section 2 with clear pattern

### Task 5: Extended Validation (15 cases)
- Selected 15 non-gold cases: 8 "flagged" (old pipeline failed) + 7 "enriched" (quality comparison)
- IDs: 10, 23, 59, 75, 78, 108, 114, 118, 131, 138, 226, 235, 238, 285, 287
- Reset all to pending, ran cloud agent across 6 trigger runs
- Scored all 15 against verified facts (SCOTUSblog, Oyez, Wikipedia)

**Result: 10/15 PASS (66.7%) — DOES NOT MEET pass criteria (0 FAILs required)**

### Prompt Iteration: Anti-Default-Bias Fix
- Added explicit instructions to Step 4: "Do NOT guess vote splits or authorship"
- Added validation checks to Step 5: verify vote_split and author found explicitly in text
- Key instruction: "It is better to flag uncertainty than to guess wrong"

## Failure Analysis

| ID | Case | What Failed | Root Cause |
|----|------|-------------|-----------|
| 23 | Vidal v. Elster | author=null (should be Thomas) | Fractured concurrences confused agent |
| 108 | Glossip v. Oklahoma | ALL fields wrong | Insufficient source text + complex case |
| 118 | SF v. EPA | vote=9-0 (should be 5-4) | Agent defaulted to unanimous |
| 138 | FDA v. Wages | author=null (should be Alito) | Agent defaulted to per curiam |
| 226 | Medina v. PP | disposition, vote, author wrong | Agent defaulted to affirmed/9-0/per curiam |

**Pattern:** Agent defaults to 9-0/per curiam when syllabus lacks explicit vote/author info.

## Throughput Findings

- Cloud agent: 1-4 cases per run (15-turn limit + ~10 setup turns)
- Fine for daily production (0-5 new cases)
- Catch-up batches should run locally (Josh confirmed)
- PostgREST response size limits Step 2 query to ~3 cases when syllabus text included

## What's Next (Next Session)

1. **Reset 5 failed cases** (23, 108, 118, 138, 226) to `enrichment_status='pending'`
2. **Trigger agent** with updated prompt (anti-default-bias instructions now in repo)
3. **Score results** — pass criteria: 0 hard-field FAILs on the 5 re-run cases
   - Cases that flag `needs_manual_review=true` with correct uncertainty are a PASS
   - Cases that guess wrong on hard fields are still a FAIL
4. **If passes:** Move ADO-470 to Testing, document results
5. **If fails:** Another prompt iteration needed

## Files Changed
- `docs/features/scotus-claude-agent/prompt-v1.md` (JSON escaping + anti-default-bias)
- `docs/features/scotus-claude-agent/validation-results/2026-04-03-extended-pre-snapshot.json` (new)
- `docs/features/scotus-claude-agent/validation-results/2026-04-03-extended-v1.json` (new)

## Key Decision
- **Catch-up batches run locally, not via cloud agent** — Josh confirmed. Cloud agent optimized for daily 0-5 case production load.
