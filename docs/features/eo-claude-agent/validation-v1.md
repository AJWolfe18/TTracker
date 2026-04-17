# EO Claude Agent — Validation v1

**Date:** 2026-04-17
**ADO:** 479 (trigger creation), 478 AC 6-7 (gold set validation)
**Result:** PASS — 5/5 exact alarm level matches, zero banned phrases, zero factual errors

## Trigger Configuration

| Field | Value |
|-------|-------|
| Trigger ID | `trig_01KZtMsTTcxteiDDDNrCRCXt` |
| Environment | `env_01YRYGLu8C8ijpVWdPAwgVSQ` (TTracker TEST) |
| Model | `claude-opus-4-6` |
| Allowed Tools | Bash, Read, Grep, Glob, WebFetch, Write, Edit |
| Cron | (empty — manual only, no scheduled runs yet) |
| Bootstrap | Reads `docs/features/eo-claude-agent/prompt-v1.md` from `test` branch |

## Harness Description

The agent was tested against a harnessed variant of prompt-v1.md (`v1+harness`). The harness added an `order_number=in.(14349,14338,14330,14343,14317)` filter to the Step 2 query, restricting processing to the 5 gold EOs only. This is a query-narrowing change — it does not affect enrichment logic, tone, validation, or write behavior.

| SHA | Description |
|-----|-------------|
| `43ca665` | PRE_HARNESS_SHA — original prompt state |
| `6393775` | VALIDATION_COMMIT_SHA — harness active (gold filter + limit=5) |
| `9575a77` | Post-validation — harness reverted to production v1 |

## Preflight Results

1. **Eligible EO audit:** ~285 old-pipeline EOs eligible (prompt_version != v1). Confirmed isolation filter was essential.
2. **Gold EO existence:** All 5 found. IDs: `20=14317, 5=14330, 258=14338, 252=14343, 279=14349`.
3. **Federal Register:** Regular pages blocked by Cloudflare CDN. `body_html_url` endpoint works. Source URLs populated for EOs 14317 and 14330 (were null).
4. **Write test:** INSERT + DELETE on enrichment log succeeded.
5. **Preflight trigger run:** `limit=0` did NOT return 0 rows (Supabase PostgREST treats limit=0 as no-limit). Agent processed all 5 gold EOs but all writes were rejected by `prevent_enriched_at_update` trigger (prompt_version decrease blocked). **Discovery: trigger guard works as a safety net.** Proved: branch checkout, prompt read, env vars, DB connectivity, WebFetch, error handling.

## Validation Run

- **Run ID:** `eo-2026-04-17T04-38-39Z`
- **Duration:** ~8 minutes total (59-124 seconds per EO)
- **All 5 EOs enriched successfully** — zero failures

## Scoring

### Persistence (all pass)

- 5 log rows, 1:1 mapping, all `completed`, zero zombies
- All `enriched_at` timestamps after run start (04:38Z)
- All `prompt_version = 'v1'`
- All sentinel fields replaced (RESET_FOR_VALIDATION → real content, education → correct category)
- severity_rating mapping correct: 5→critical, 4→high, 3→medium, 2→low, 1→null

### Content

| EO | Alarm (gold→actual) | Category | Named Actor | Banned | Factual |
|----|---------------------|----------|-------------|--------|---------|
| 14317 Schedule G | 5→5 EXACT | gov_ops_workforce ✓ | OPM + 50K-200K victims ✓ | 0 | §3302, Pendleton, CSRA ✓ |
| 14330 401k | 3→3 EXACT | economy_jobs_taxes ✓ | Blackstone/KKR/Apollo ✓ | 0 | ERISA, Fink, Chavez-DeRemer ✓ |
| 14338 Architecture | 2→2 EXACT | gov_ops_workforce ✓ | No-beneficiary sentence ✓ | 0 | EO 13967, GSA, 1962 ✓ |
| 14343 Labor | 4→4 EXACT | gov_ops_workforce ✓ | AFGE/NTEU/NFFE + 200K ✓ | 0 | §7103(b)(1), Reagan 1983 ✓ |
| 14349 LIRR | 1→1 EXACT | economy_jobs_taxes ✓ | Exact no-beneficiary sentence ✓ | 0 | §160, RLA 1926, 250+ boards ✓ |

**Alarm level: 5/5 exact matches. Zero systematic drift.**
**Banned phrases: 0 across all 25 text fields.**
**Factual errors: 0.**
**Profanity compliance: correct (present at level 5 only).**
**Action tier consistency: all correct (direct with URLs, tracking with null).**

## Discoveries

1. **`limit=0` on Supabase PostgREST = no limit, not zero rows.** The preflight `limit=0` trick didn't work. The gold-set `order_number` filter was the actual isolation mechanism.
2. **Federal Register Cloudflare CDN blocks WebFetch** on regular page URLs. The agent successfully worked around this (likely via the prompt's search fallback or direct `body_html_url`). Production prompt may benefit from documenting the `body_html_url` pattern.
3. **`prevent_enriched_at_update` trigger** correctly rejected all preflight writes (prompt_version decrease). This guard works as designed and protected gold EO data from the accidental preflight processing.
4. **NOT NULL constraints** on `section_*`, `action_reasoning`, `category` (enum), `regions`, `policy_areas`, `affected_agencies` required sentinel values (empty strings, `education`, empty arrays) instead of null for baseline reset.

## Quality Highlights

- EO 14349 (LIRR, level 1): "This is the boring part of government that usually works." — exactly the tone calibration we need. The old pipeline rated this 4.
- EO 14338 (Architecture, level 2): "file this under 'executive branch cosplaying as an art school.'" — sardonic without being overwrought. Old pipeline rated this 4.
- EO 14317 (Schedule G, level 5): "They actually fucking did it." — earned profanity at the highest alarm level, with specific legal citations backing every claim. 
- Named actors: Blackstone, KKR, Apollo, BlackRock, Larry Fink (14330) — specific, verifiable, not generic "corporate interests."

## Structured Results

See: `validation-results/2026-04-16-gold-set-v1.json`
