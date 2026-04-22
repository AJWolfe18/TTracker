# EO Bulk Enrichment Plan

**Created:** 2026-04-21 | **Updated:** 2026-04-22 (v6 — COMPLETE. Backlog = 0.)
**Ticket:** ADO-481
**Goal:** Re-enrich all ~224 remaining EOs from legacy GPT pipeline to v1.1
**Standard:** `docs/features/eo-claude-agent/prompt-v1.md` — the SAME rules the cloud agent follows

## Current State

- **Done:** 250 at v1.1 (ALL EOs enriched from FR text)
- **Remaining:** 0 ✅
- **Daily cron:** Active, 5/day weekdays via PROD trigger (handles new EOs)
- **Backlog drained:** Session 5 (2026-04-22)
- **ADO-489:** DONE (SCOTUS trigger git-pull fix applied)

## Per-EO Process (NO EXCEPTIONS)

**Same process the cloud agent uses.** Manual enrichment follows prompt-v1.md identically.

### Step 1: Fetch Source Text
```
https://www.federalregister.gov/documents/full_text/html/{year}/{month}/{day}/{doc_number}.html
```
**Fallback chain** (try in order, stop when text > 500 chars):
1. FR body_html_url (above)
2. govinfo: `https://www.govinfo.gov/content/pkg/FR-{year}-{month}-{day}/html/{doc_number}.htm`
3. FR API: `https://www.federalregister.gov/api/v1/documents/{doc_number}.json`
4. **If all fail:** mark failed, skip. NEVER write from knowledge.

### Step 2: Write Enrichment (from prompt-v1.md §3-4)

**Neutral field:**
- `summary` — 2-3 sentences, neutral, no editorial framing, no profanity

**4-Part Editorial (150-200 words each, HARD CEILING 200):**
- `section_what_they_say` — neutral, cite specific statutory authorities FROM THE ORDER TEXT
- `section_what_it_means` — "The Power Grab" voice, match tone to alarm_level. MUST contain named actor tied to harm/benefit OR exact sentence "No specific beneficiary is identifiable from the order text or signing statement."
- `section_reality_check` — call out contradictions, name specific historical precedents. NO "dangerous precedent" or "under the guise of"
- `section_why_it_matters` — forward-looking, end with "What to watch for" or "What readers can do"

**Tone calibration by alarm_level (from prompt-v1.md §4):**
| Level | Label | Tone | Profanity |
|---|---|---|---|
| 5 | Authoritarian Power Grab | Cold fury, prosecutorial | YES |
| 4 | Weaponized Executive | Suspicious, name names | YES |
| 3 | Corporate Giveaway | Sardonic, dark humor | NO |
| 2 | Smoke and Mirrors | Eye-roll, point out posturing | NO |
| 1 | Surprisingly Not Terrible | Cautious credit, flag asterisks | NO |
| 0 | Actually Helpful | Suspicious celebration | NO |

**Alarm-level discipline:**
- Start at 2. Earn every upgrade with specific evidence from FR text.
- Upgrade to 3: named industry beneficiary OR broad class harmed
- Upgrade to 4: named victim class with concrete measurable harm OR named beneficiary with lobbying trail
- Upgrade to 5: structural rewiring of government, constitutional-scale, immediate enforcement
- If first 3 EOs all come out at 4: STOP and re-examine

**Banned phrases (NEVER use anywhere):**
- "dangerous precedent"
- "under the guise of"
- Plus 27 banned openings from tone-system.json (see prompt-v1.md §4)

**Metadata:**
- `alarm_level` 0-5 (earned)
- `severity_rating` mapped: 0-1→null, 2→low, 3→medium, 4→high, 5→critical
- `category` — one of 10: `immigration_border`, `environment_energy`, `health_care`, `education`, `justice_civil_rights_voting`, `natsec_foreign`, `economy_jobs_taxes`, `technology_data_privacy`, `infra_housing_transport`, `gov_ops_workforce`
- `regions`, `policy_areas`, `affected_agencies` — max 3 each
- `action_tier` — direct/systemic/tracking with matching `action_section`
- `enrichment_meta.source` = `"federal-register"`
- `prompt_version` = `"v1.1"`

### Step 3: Quality Check (before every UPDATE)
- [ ] alarm_level earned, not defaulted to 4?
- [ ] severity_rating matches mapping?
- [ ] category is valid enum?
- [ ] All editorial sections 150-200 words?
- [ ] Named-actor rule satisfied?
- [ ] No banned phrases or openings?
- [ ] No profanity at levels 0-3?
- [ ] action_tier matches action_section presence?
- [ ] Arrays ≤ 3 entries?
- [ ] Statutory authorities from FR text only?

### Step 4: UPDATE via SQL
Dollar-quoted text, `enrichment_meta.source = "federal-register"`, `prompt_version = 'v1.1'`.

## Session Execution Pattern

Each session, loop until done:

1. Query next 5 unenriched: `WHERE prompt_version != 'v1.1' OR prompt_version IS NULL ORDER BY date ASC LIMIT 5`
2. **Parallel fetch:** 5 WebFetch calls for FR text simultaneously
3. **Write editorial** for each from FR text (sequential — needs context per EO)
4. **Parallel UPDATE:** 5 SQL calls simultaneously
5. **Repeat** from step 1 with next 5
6. **Do NOT stop for checkpoints.** Run the full loop until remaining = 0.

## Throughput (updated Session 4)

| Channel | Rate | Notes |
|---|---|---|
| Manual (in-session) | 60+/session | 12 batches of 5, parallel fetch + SQL |
| PROD trigger (auto) | 5/day weekdays | Handles trickle once backlog drained |
| **Time to drain** | **1 more session** | 58 remaining, easily achievable |

**Post-backlog:** New EOs are sparse (0-3/week). The daily trigger handles steady-state easily.

## Opening Variety Rule

**Avoid repetitive `section_what_it_means` openings.** Session 4 audit found ~17% started with "This is..." — acceptable but flagged. Rules:
- Never start two consecutive EOs with the same opening pattern
- Lead with the specific subject, a direct observation, or a punchy framing — not "This order..." or "This is..."
- Vary across: named-target leads, framing-deconstruction leads, data-first leads, voice/tone leads, question leads
- **Daily trigger (prompt-v1.md):** Check if the prompt already has opening variety guidance. If not, add a note in the next prompt revision. The trigger only does 1-5 EOs/day so repetition risk is low, but worth a line in the prompt.

## Quality Gates

- `enrichment_meta.source` MUST be `"federal-register"` — anything else means process was skipped
- FR text < 500 chars = failed fetch, skip
- Statutory authorities from order text ONLY — never from training knowledge
- Named actors from FR text or clearly identified affected parties — never fabricated
- **Spot-check (non-blocking):** Josh reviews a sample via admin dashboard when convenient. Enrichment never pauses for review — if issues found, fixes happen in next session alongside continued enrichment

## Backlog Drain Tracking

| Session | Date | Manual | Trigger | Total Done | Remaining |
|---|---|---|---|---|---|
| 2 | 2026-04-21 | 17 | 10 | 27 | 224 |
| 3 | 2026-04-21 | 100 | ~5 | 132 | 118 |
| 4 | 2026-04-21 | 60 | ~5 | 192 | 58 |
| 5 | 2026-04-22 | 58 | ~5 | 250 | 0 |

**Session 4 notes:** Covered EOs 14277-14336 (Apr 28 – Aug 19, 2025). Alarm distribution: 1×5, 5×4, 13×3, 33×2, 8×1, 0×0. Zero level-4 saturation (legacy was 88%). Opening variety audit: ~17% "This is..." — flagged, adding variety rule above. `action_section` is JSONB (reader actions), not text — don't overwrite it; `action_tier = 'tracking'` requires `action_section = NULL`.

**Session 5 notes:** Covered EOs 14337-14400 (Aug 19, 2025 – Apr 9, 2026). All 58 completed in one session without stopping. Alarm distribution: 14×1, 30×2, 12×3, 3×4, 0×5. Zero level-4 saturation. Level-4s were: 14343 (labor exclusions), 14398 (anti-DEI contractors), 14399 (election citizenship verification). One title correction: EO 14361 was "Regulatory Relief for Coke Oven..." in DB but FR says "Modifying the Scope of Tariffs on the Government of Brazil" — corrected during enrichment. Opening variety rule applied throughout — no consecutive duplicate patterns. `action_tier = 'systemic'/'direct'` requires non-null `action_section` (learned from 14337 constraint error in batch 1).

**BACKLOG COMPLETE.** Daily PROD trigger handles new EOs going forward. Next: run `/end-work`, then sync PROD → TEST.

## Post-Backlog: Sync PROD → TEST

Once the backlog is fully drained, copy PROD data to TEST DB for both:
- `executive_orders` table (all enriched EO rows)
- `scotus_cases` table (all enriched SCOTUS rows)

This keeps TEST in sync for development/testing against real enriched content.

## Pre-Session Checklist

- [ ] `git branch --show-current` → test
- [ ] Read this plan + memory
- [ ] Query remaining: `SELECT COUNT(*) FROM executive_orders WHERE prompt_version != 'v1.1' OR prompt_version IS NULL`
- [ ] Start enrichment loop
