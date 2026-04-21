# EO Bulk Enrichment Plan

**Created:** 2026-04-21 | **Updated:** 2026-04-21 (v3 — full standards)
**Ticket:** ADO-481 (Active)
**Goal:** Re-enrich all ~224 remaining EOs from legacy GPT pipeline to v1.1
**Standard:** `docs/features/eo-claude-agent/prompt-v1.md` — the SAME rules the cloud agent follows

## Current State

- **Done:** 27 at v1.1 (all factual errors fixed, all reviewed against FR text)
- **Remaining:** 224 (171 at v1 + 53 at NULL)
- **Daily cron:** Active, 5/day weekdays via PROD trigger
- **Next in queue:** EO 14189 "Celebrating America's 250th Birthday" (2025-02-03) — 14187 already done
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

Each session, loop until context runs low:

1. Query next 5 unenriched: `WHERE prompt_version = 'v1' OR prompt_version IS NULL ORDER BY date ASC LIMIT 5`
2. **Parallel fetch:** 5 WebFetch calls for FR text simultaneously
3. **Write editorial** for each from FR text (sequential — needs context per EO)
4. **Parallel UPDATE:** 3-5 SQL calls simultaneously
5. **Repeat** from step 1 with next 5
6. **Target: 15-20 EOs per session** (3-4 loops of 5)

## Throughput

| Channel | Rate | Notes |
|---|---|---|
| Manual (in-session) | 15-20/session | 3-4 batches of 5, parallel fetch + SQL |
| PROD trigger (auto) | 5/day weekdays | Handles trickle once backlog drained |
| **Combined** | **~25/day** | 1 session/day + auto-cron |
| **Time to drain** | **~10 sessions** | 224 ÷ 25 ≈ 9-10 sessions |

**Post-backlog:** New EOs are sparse (0-3/week). The daily trigger handles steady-state easily.

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
| 3 | | | | | |
| 4 | | | | | |

## Pre-Session Checklist

- [ ] `git branch --show-current` → test
- [ ] Read this plan + memory
- [ ] Query remaining: `SELECT COUNT(*) FROM executive_orders WHERE prompt_version != 'v1.1' OR prompt_version IS NULL`
- [ ] Start enrichment loop
