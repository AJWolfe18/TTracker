# Claude Pardons Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Perplexity + GPT pardons enrichment pipeline with a single Claude Code cloud scheduled agent that does web research, fact extraction, and editorial writing in one pass.

**Architecture:** A cloud scheduled task runs daily on Anthropic infrastructure, queries Supabase via direct PostgREST HTTP calls (Bash/curl) for unenriched pardons, searches the web for crime details and Trump connections, produces all enrichment fields in a single pass, writes results back via PostgREST, and logs every run to an observability table. The agent auto-publishes (sets `is_public=true`).

**Tech Stack:** Claude Opus 4.6 (cloud agent), Supabase PostgREST API (direct HTTP via Bash/curl), WebFetch (for web research only)

**PRD:** `docs/features/pardons-claude-agent/prd.md`
**ADO Epic:** ADO-516 (child of Epic 109)

---

## Why This Route

### The Problem We're Solving

The current pardons enrichment uses two separate AI tools:
1. **Perplexity Sonar** (~$0.0065/pardon) — web research for Trump connections
2. **GPT-4o-mini** (~$0.003/pardon) — editorial tone from research data

This pipeline has systemic quality failures:
- **116/118 PROD pardons have empty `crime_description`** — the column exists but nothing writes to it
- **69/118 at corruption_level 1** — Perplexity misses connections that a reasoning model would catch
- **Wrong levels on high-profile pardons** — Tina Peters L3→L4, FACE Act protesters L1→L3, Hernandez L1→L3-4
- **Two-phase handoff loses context** — research findings get compressed before GPT sees them

### Why a Single-Pass Agent Fixes This

When the same model researches, extracts facts, AND writes editorial:
- Crime description is naturally produced (agent reads what they did)
- Connection research uses reasoning, not keyword matching
- No information loss between research and editorial phases
- Web research is contextual — agent can follow leads, check FEC records, read court docs
- $0 marginal cost (subscription-included vs ~$1.50/month)

### What We're Replacing

| Component | File | Lines | Status |
|-----------|------|-------|--------|
| Perplexity research | `scripts/enrichment/perplexity-research.js` | ~290 | Replaced |
| Perplexity client | `scripts/enrichment/perplexity-client.js` | ~150 | Replaced |
| GPT enrichment | `scripts/enrichment/enrich-pardons.js` | ~250 | Replaced |
| GPT prompt | `scripts/enrichment/pardons-gpt-prompt.js` | ~300 | Replaced |
| Variation pools | `scripts/enrichment/pardons-variation-pools.js` | ~200 | Replaced |
| Research workflow | `.github/workflows/research-pardons.yml` | ~60 | Replaced |
| Enrichment workflow | `.github/workflows/enrich-pardons.yml` | ~60 | Replaced |
| **Total** | **7 files** | **~1,310 lines** | |

### What We're Keeping

| Component | Why |
|-----------|-----|
| `scripts/scrape-doj-pardons.js` | DOJ scraper works fine, ingests raw pardons |
| `.github/workflows/pardons-tracker.yml` | Daily DOJ scraper trigger (18:00 UTC) |
| Admin dashboard (`admin-pardons` edge function) | Already supports `crime_description` editing |
| Shared tone modules (`severity-config.js`, etc.) | Used by prompt reference, may serve future features |
| `public/shared/tone-system.json` | Single source of truth for voice/labels |

---

## Architecture Diagram

```
DOJ Clemency Page
    ↓ (daily GitHub Action at 18:00 UTC — UNCHANGED)
pardons-tracker.yml → scrape-doj-pardons.js
    ↓ Inserts raw pardons (is_public=false, no enrichment)
    ↓
    ↓ (daily cloud agent at 20:00 UTC — NEW, 2hrs after DOJ scraper)
    ↓
Claude Agent (Opus 4.6, Anthropic cloud)
    ├── Connects: Supabase PostgREST via Bash/curl (service key in env vars)
    ├── Checks: pardons_enrichment_log for overlapping runs
    ├── Logs: POST run start to pardons_enrichment_log (status='running')
    ├── Reads: GET pardons WHERE enriched_at IS NULL (or needs re-enrichment)
    ├── Researches: WebFetch news articles, FEC records, court docs per pardon
    ├── Reasons: single-pass research + fact extraction + editorial
    ├── Writes: PATCH enrichment fields to pardons (including crime_description)
    ├── Sets: is_public=true (auto-publish)
    ├── Logs: PATCH run completion to pardons_enrichment_log
    └── Never: fabricates connections without web sources
    ↓
Admin Review (Josh)
    ├── Reviews enrichment via admin dashboard Pardons tab
    ├── Edits crime_description, corruption_level if needed
    └── Flags issues for prompt iteration
```

### Schedule

**DOJ scraper:** 18:00 UTC daily (pardons-tracker.yml)
**Cloud agent:** 20:00 UTC daily (2 hours after scraper, allows news coverage to accumulate for new pardons)

Why 2 hours gap (not 1 hour like SCOTUS):
- New pardons need time for news coverage to exist so the agent can research connections
- SCOTUS opinions have text in the DB already; pardons need web research
- 2 hours gives news outlets time to publish context articles

---

## Key Differences from SCOTUS/EO Agent

| Aspect | SCOTUS | EO | Pardons |
|--------|--------|-----|---------|
| Source text | In-DB syllabus/opinion | Federal Register (WebFetch) | Web research (WebFetch) |
| Research phase | Reads stored text | Reads FR HTML page | Searches web for connections |
| New field | N/A | N/A | `crime_description` (currently empty) |
| Severity field | `ruling_impact_level` | `alarm_level` | `corruption_level` |
| Anti-bias target | Level 3-4 drift | Level 4 saturation (88%) | Level 1 flatline (40%) |
| Tone voice | "The Betrayal" | "The Power Grab" | "The Transaction" |
| Volume | 0-5/day | 0-3/day | 0-5/day |
| Auto-publish | Yes (is_public=true) | Yes (is_public=true) | Yes (is_public=true) |
| DB access | Bash/curl to PostgREST | Bash/curl to PostgREST | Bash/curl to PostgREST |

---

## Prompt Design

### Prompt Structure (mirrors SCOTUS/EO skeleton)

```
1. Role & Task (what you are, what you do, what you NEVER do)
2. Environment Setup (env vars, verification)
3. PostgREST API Reference (Bash/curl, auth headers, GET/POST/PATCH)
4. Step A: Git pull latest prompt (bootstrap)
5. Step 1: Log run start
6. Step 1.5: Concurrent run check
7. Step 2: Find unenriched pardons
8. Step 3: Web research per pardon (WebFetch news, FEC, court docs)
9. Step 4: Produce enrichment (corruption level calibration, The Transaction voice)
10. Gold Set Calibration Examples (5 embedded examples at levels 0-5)
11. Step 5: Validate before writing
12. Step 6: Write to database (atomic PATCH per pardon)
13. Step 7: Log run completion
14. Failure Handling
15. Security (untrusted input defense, web content handling)
16. Invariants (hard rules)
```

### Critical Prompt Requirements

| Issue | How Prompt Addresses It |
|-------|------------------------|
| Empty crime_description | Explicit instruction: ALWAYS populate crime_description from DOJ offense_raw + web research |
| L1 flatline (40%) | Anti-default-bias: "start at L2, earn upgrades with evidence"; distribution quota |
| Missed connections | Web research workflow: search news, FEC, PACER for each pardon |
| Fabricated connections | "Every claim must link to a web source you actually read" |
| Auto-publish | `is_public=true` in PATCH payload (matches EO/SCOTUS) |
| The Transaction voice | Full tone-system.json integration with level-specific calibration |
| Concurrent runs | Check pardons_enrichment_log for status='running' < 30min old |

### Corruption Level Calibration (from perplexity-research.js, validated)

| Level | Label | Mechanism | Anti-Bias Rule |
|-------|-------|-----------|----------------|
| 5 | Pay 2 Win | MONEY (donations, PAC, inaugural) | Must find FEC/financial records |
| 4 | Cronies-in-Chief | DIRECT (inner circle, family, staff) | Must document personal relationship |
| 3 | The Party Favor | NETWORK (MAGA, GOP allies, campaign promise) | THIS IS THE DEFAULT, not L1 |
| 2 | The PR Stunt | FAME (celebrity, media attention) | Only if famous AND no network tie |
| 1 | The Ego Discount | FLATTERY (DM'd Trump, no other connection) | RARE — most "no connection" is actually L3 |
| 0 | Actual Mercy | MERIT (genuinely deserved, no Trump ties) | Auto-flags needs_review=true |

**Key anti-bias rule:** If first 3 pardons all come out at L1, STOP and recalibrate. L1 should be <10% of output.

### Gold Set Candidates

| Pardon | Expected Level | Why Selected |
|--------|---------------|-------------|
| Steve Bannon (id TBD) | L4 | Inner circle, contempt of Congress, direct Trump relationship |
| Tina Peters (id TBD) | L4 | Election fraud crusader, Trump personally called CO SoS |
| FACE Act protester (id TBD) | L3 | Campaign promise — "vote for me, I'll free you" |
| Ross Ulbricht (id 8) | L3 | Libertarian campaign promise, political ally network |
| A genuinely meritorious pardon (id TBD) | L0-L1 | No Trump connection, actual criminal justice reform |

Gold set candidates must be verified against PROD data before prompt is finalized (Task 2, Step 1).

### Column Governance (explicit in prompt)

**AGENT WRITES these columns on `pardons`:**
`crime_description`, `primary_connection_type`, `secondary_connection_types`, `corruption_level`,
`corruption_reasoning`, `trump_connection_detail`, `donation_amount_usd`,
`receipts_timeline` (JSONB array — MUST be `[]` not `null`, column is NOT NULL),
`summary_neutral`, `summary_spicy`, `why_it_matters`, `pattern_analysis`,
`source_urls` (JSONB array — MUST be `[]` not `null`, column is NOT NULL),
`enriched_at`, `enrichment_prompt_version` (= 'v1'), `prompt_version` (= 'v1'),
`enrichment_meta` (JSONB — model info and provenance, matches EO pattern),
`is_public` (= true), `needs_review` (= true when corruption_level = 0 or low confidence)

**AGENT NEVER WRITES these columns:**
`recipient_name`, `recipient_slug`, `nickname`, `photo_url`, `recipient_type`,
`recipient_count`, `recipient_criteria`, `pardon_date`, `clemency_type`, `status`,
`conviction_district`, `case_number`, `offense_raw`, `original_sentence`, `conviction_date`,
`source_system`, `source_key`, `research_status`, `research_prompt_version`, `researched_at`,
`post_pardon_status`, `post_pardon_notes`, `crime_category`

**Note on `crime_category`:** The agent does NOT write this because it's an enum (`white_collar`, `obstruction`, etc.) that may not align cleanly with what the agent would produce. Keep it manually assigned or derive from existing DOJ data. Future iteration could add this.

**Note on `enrichment_prompt_version`:** The agent writes this alongside `enriched_at` to enable version-aware re-enrichment. To re-enrich on prompt bumps, query `WHERE enrichment_prompt_version IS DISTINCT FROM 'v1' OR enriched_at IS NULL`.

---

## Observability

### `pardons_enrichment_log` Table

```sql
CREATE TABLE IF NOT EXISTS pardons_enrichment_log (
    id BIGSERIAL PRIMARY KEY,
    ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed')),
    agent_model TEXT NOT NULL DEFAULT 'claude-opus-4-6',
    prompt_version TEXT NOT NULL,
    pardons_found INTEGER NOT NULL DEFAULT 0,
    pardons_enriched INTEGER NOT NULL DEFAULT 0,
    pardons_failed INTEGER NOT NULL DEFAULT 0,
    pardons_skipped INTEGER NOT NULL DEFAULT 0,
    pardon_details JSONB DEFAULT '[]'::jsonb,
    -- Per-pardon: [{id, recipient_name, corruption_level, status, error?}]
    errors JSONB DEFAULT '[]'::jsonb,
    run_source TEXT NOT NULL DEFAULT 'cloud-agent',
    -- 'cloud-agent' | 'manual'
    duration_seconds INTEGER
);

CREATE INDEX IF NOT EXISTS idx_pardons_enrichment_log_ran_at
    ON pardons_enrichment_log (ran_at DESC);

-- Enable RLS — without it, anon key could read run logs including
-- non-public pardon recipient names in pardon_details JSONB
ALTER TABLE pardons_enrichment_log ENABLE ROW LEVEL SECURITY;
```

---

## Validation Strategy

### Phase 1: Gold Set (5 pardons)

1. Reset 5 gold set pardons to `enriched_at = NULL` on TEST
2. Run agent
3. Score per-field:
   - `crime_description`: non-empty, factually accurate (manual check)
   - `corruption_level`: within ±1 of expected
   - `primary_connection_type`: correct enum value
   - `trump_connection_detail`: sourced, not fabricated
   - `summary_spicy`: The Transaction voice, no banned openings
   - `source_urls`: non-empty, URLs are real

**Pass criteria:** 100% crime_description populated. 0 fabricated connections. corruption_level within ±1 for all 5.

### Phase 2: Extended (10-15 pardons)

1. Run agent on additional pending pardons
2. Manual review of every enrichment
3. Check corruption_level distribution (should NOT be 40% at L1)

**Pass criteria:** 0 fabricated connections across 15 pardons. L1 < 20% of output.

---

## File Structure

```
docs/features/pardons-claude-agent/
├── prd.md                     # Product requirements (DONE)
├── plan.md                    # This file
├── prompt-v1.md               # The agent prompt (Task 2)
└── validation-results/        # Gold set comparison outputs
    └── YYYY-MM-DD-*.json

migrations/
└── 094_pardons_enrichment_log.sql  # Observability table (Task 1)
```

---

## Tasks

### Task 1: Create Observability Migration (ADO-518)

**Files:**
- Create: `migrations/094_pardons_enrichment_log.sql`

- [ ] **Step 1: Write the migration**

Use the SQL from the Observability section above. Mirror `090_scotus_enrichment_log.sql` structure exactly, with pardons-specific column names (`pardons_found`, `pardons_enriched`, `pardons_failed`, `pardons_skipped`, `pardon_details`). Include RLS enablement (matching 090/091 pattern) and ran_at index.

- [ ] **Step 2: Apply migration to TEST**

Run via Supabase Dashboard SQL Editor (Josh action) or `execute_sql` MCP tool.

- [ ] **Step 3: Verify table exists**

Query via MCP: `GET /pardons_enrichment_log?select=count`
Expected: empty table, no error.

- [ ] **Step 4: Commit**

```bash
git add migrations/094_pardons_enrichment_log.sql
git commit -m "feat: add pardons_enrichment_log table for cloud agent observability (ADO-518)"
```

---

### Task 2: Write the Agent Prompt (ADO-519)

**Files:**
- Create: `docs/features/pardons-claude-agent/prompt-v1.md`

This is the most critical task. The prompt must be self-contained (agent starts cold every run) and handle web research, which SCOTUS/EO prompts don't need to do.

- [ ] **Step 1: Read gold set candidates from PROD**

Query PROD pardons to identify 5 gold set candidates:
- One L4 (Tina Peters or Steve Bannon) — verify recipient_name and id
- One L3 (FACE Act protester or similar) — verify id
- One L3 (Ross Ulbricht, id=8 on TEST, verify PROD id)
- One L1-L2 (celebrity or genuine low-connection)
- One L0 (genuinely meritorious, if exists; otherwise L1)

For each, research the expected enrichment output independently.

- [ ] **Step 2: Write the full prompt**

Follow the prompt structure from the Prompt Design section. Key differences from SCOTUS/EO:

1. **Web research workflow:** Agent uses WebFetch to search for news, FEC records, court documents per pardon. SCOTUS/EO read text from DB or Federal Register. Pardons need active web research.

2. **crime_description generation:** Explicit section: "Read the `offense_raw` field (from DOJ). Search for the actual conviction details. Write a 1-2 sentence human-readable crime description."

3. **Anti-L1-bias:** "The default level for a pardon with any political connection is L3, not L1. L1 means you searched and found NOTHING — no campaign promise, no network tie, no donation, no political ally advocacy."

4. **PostgREST API reference:** Identical to SCOTUS/EO (Bash/curl, not WebFetch for DB calls).

5. **Bootstrap Step A:** `git fetch origin test && git reset --hard origin/test` (reads prompt from test branch during validation; switch to `main` for PROD).

- [ ] **Step 3: Review prompt against EO/SCOTUS checklists**

Verify:
- PostgREST base URL + auth headers via env vars? YES/NO
- crime_description always populated? YES/NO
- Anti-default-bias mechanisms? YES/NO
- The Transaction voice with level calibration? YES/NO
- Banned openings from tone-system.json? YES/NO
- Web research workflow documented? YES/NO
- JSON body via Write tool (not inline curl -d)? YES/NO
- is_public always true? YES/NO
- Observability log writes? YES/NO
- WRITE / NEVER-WRITE column lists? YES/NO
- Concurrent run check? YES/NO
- Prompt injection defense (web content is untrusted)? YES/NO

- [ ] **Step 4: Save and commit**

```bash
git add docs/features/pardons-claude-agent/prompt-v1.md
git commit -m "feat: pardons cloud agent prompt v1 with gold set calibration (ADO-519)"
```

---

### Task 3: Create Cloud Trigger & Validate (ADO-520)

**Files:**
- No file changes — RemoteTrigger API call + validation doc

- [ ] **Step 0: Prerequisites**

**Cloud Environment:** Reuse existing TTracker TEST environment (`env_01YRYGLu8C8ijpVWdPAwgVSQ`).

**VERIFY env vars before proceeding** (env may have drifted since last use):
- `SUPABASE_URL` = TEST URL (`https://wnrjrywpcadwutfykflu.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` = TEST service key
- Network: Full access required
- Check at claude.ai/code → Manage Cloud Environments → TTracker TEST

- [ ] **Step 1: Reset gold set pardons to unenriched**

```sql
UPDATE pardons
SET enriched_at = NULL, is_public = false
WHERE id IN (gold_set_ids_from_task_2);
```

Save current values first (for rollback).

- [ ] **Step 2: Create the trigger**

Two-step process (create then update):
1. Create with infrastructure config (environment, tools, cwd)
2. Update with prompt content, repo URL, model (claude-opus-4-6), max_turns=15

Bootstrap Step A reads `docs/features/pardons-claude-agent/prompt-v1.md` from test branch.

- [ ] **Step 3: Trigger manual run**

Use RemoteTrigger with action `run`.

- [ ] **Step 4: Score against gold truth**

For each of 5 pardons:

| Field | Criteria | Score |
|-------|----------|-------|
| crime_description | Non-empty, factually accurate | PASS/FAIL |
| corruption_level | Within ±1 of expected | PASS/FLAG/FAIL |
| primary_connection_type | Correct enum | PASS/FAIL |
| trump_connection_detail | Sourced, not fabricated | PASS/FAIL |
| summary_spicy | The Transaction voice | PASS/FLAG |
| source_urls | Non-empty, real URLs | PASS/FAIL |

**Pass criteria:** 100% PASS on crime_description. 0 fabricated connections. corruption_level within ±1 for all 5.

- [ ] **Step 5: Document results**

Save to `docs/features/pardons-claude-agent/validation-results/YYYY-MM-DD-gold-set-v1.json`

Write `docs/features/pardons-claude-agent/validation-v1.md` with summary.

---

### Task 4: Admin Tab Updates (ADO-521)

**FINDING: `crime_description` editing is already done.** It's in `PARDON_ALLOWED_FIELDS` (admin.html line 2361) and `EditPardonModal` (admin.html line 1532).

**HOWEVER: Two edge function bugs MUST be fixed before the agent goes live:**

1. **`admin-update-pardon` validates `corruption_level` as 1-5 (line ~170)** — rejects 0. The agent writes L0 for "Actual Mercy" pardons. Fix: change validation to `0-5` to match the database CHECK constraint (updated in migration 063).

2. **`admin-update-pardon` `VALID_CONNECTION_TYPES` is stale (line ~35)** — missing `wealthy_unknown`, `cabinet_connection`, `lobbyist` (added in migration 062). If the agent writes any of these, admin edits to that pardon will fail.

- [ ] **Step 1: Fix corruption_level validation in `admin-update-pardon`**

Change `level < 1 || level > 5` to `level < 0 || level > 5`.

- [ ] **Step 2: Add missing connection types to `VALID_CONNECTION_TYPES`**

Add `'wealthy_unknown'`, `'cabinet_connection'`, `'lobbyist'` to the array.

- [ ] **Step 3: Verify `crime_description` saves correctly**

Test via admin dashboard on TEST.

- [ ] **Step 4: Deploy updated edge function to TEST**

```bash
supabase functions deploy admin-update-pardon --project-ref wnrjrywpcadwutfykflu
```

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: admin-update-pardon validation for L0 corruption + missing connection types (ADO-521)"
```

---

### Task 5: PROD Launch & Re-Enrichment (ADO-522)

**Prerequisites:**
- PR #94 merged (auto-publish fix — currently OPEN, all checks pass, mergeable)
- Tasks 1-3 validated on TEST
- Task 4 verified

- [ ] **Step 1: Merge PR #94**

Josh action — PR is mergeable, all checks pass.

- [ ] **Step 2: Create deployment branch**

```bash
git checkout main && git pull
git checkout -b deploy/pardons-agent-prod
```

Cherry-pick commits from test:
- Migration 094 (pardons_enrichment_log)
- Prompt v1 doc
- Any admin.html changes (if Task 4 produced any)

Check `.claude/test-only-paths.md` — skip test-only files.

- [ ] **Step 3: Apply migration to PROD**

Run `094_pardons_enrichment_log.sql` via Supabase Dashboard SQL Editor on PROD.

- [ ] **Step 4: Push and create PR**

```bash
git push -u origin deploy/pardons-agent-prod
gh pr create --title "feat: Claude pardons agent infrastructure (ADO-522)" --body "..."
```

Wait for AI code review. Merge after passing.

- [ ] **Step 5: Create PROD cloud trigger**

New trigger pointing at PROD environment (`env_018AS3Shj6wkH624v1nkssG9`):
- Model: claude-opus-4-6
- Bootstrap reads prompt-v1.md from `main` branch
- Step A: `git fetch origin main && git reset --hard origin/main`
- Schedule: `0 20 * * *` (20:00 UTC daily, 2hrs after DOJ scraper)

- [ ] **Step 6: Re-enrich all ~118 pardons**

Two options (decide at execution time):
1. **Manual from Claude Code session** (SCOTUS precedent — 116/116 in ~2.5hrs): Query batches of 5-10, WebFetch for each, write enrichment. Faster for backlog.
2. **Cloud agent manual triggers** (1-5 pardons per run): Slower but less context burn. ~25-40 runs needed.

Recommendation: Manual session for backlog (proven pattern), then daily trigger for new pardons.

- [ ] **Step 7: Spot-check 10 random pardons**

Pick 10 across corruption levels. Verify:
- crime_description accurate
- corruption_level reasonable
- No fabricated connections
- source_urls are real
- The Transaction voice in summaries

- [ ] **Step 8: Enable daily cron**

Set trigger schedule to `0 20 * * *` (if not already enabled).

- [ ] **Step 9: Verify corruption_level distribution**

```sql
SELECT corruption_level, COUNT(*) FROM pardons GROUP BY 1 ORDER BY 1;
```

Expected: L1 < 20% (currently 40%). L3 should be the largest bucket.

---

### Task 6: Retire Legacy Scripts (ADO-523)

**Files to delete (7):**
- `scripts/enrichment/perplexity-research.js`
- `scripts/enrichment/perplexity-client.js`
- `scripts/enrichment/enrich-pardons.js`
- `scripts/enrichment/pardons-gpt-prompt.js`
- `scripts/enrichment/pardons-variation-pools.js`
- `.github/workflows/research-pardons.yml`
- `.github/workflows/enrich-pardons.yml`

**Files to keep:**
- `scripts/scrape-doj-pardons.js` — DOJ scraper still works
- `.github/workflows/pardons-tracker.yml` — daily scraper trigger
- `scripts/shared/severity-config.js` — shared infrastructure
- `scripts/shared/profanity-rules.js` — shared infrastructure
- `scripts/shared/banned-openings.js` — shared infrastructure

- [ ] **Step 1: Check for broken imports**

Grep for imports of the 7 files to ensure nothing else references them.

- [ ] **Step 2: Check lint-prod-refs allowlist**

```bash
grep -n "perplexity\|enrich-pardons\|pardons-gpt" .github/workflows/lint-prod-refs.yml
```

Remove any allowlist entries for deleted files.

- [ ] **Step 3: Check package.json scripts**

```bash
grep -n "research:pardons\|enrich:pardons" package.json
```

Remove npm script entries.

- [ ] **Step 4: Delete files and commit**

```bash
git rm scripts/enrichment/perplexity-research.js \
       scripts/enrichment/perplexity-client.js \
       scripts/enrichment/enrich-pardons.js \
       scripts/enrichment/pardons-gpt-prompt.js \
       scripts/enrichment/pardons-variation-pools.js \
       .github/workflows/research-pardons.yml \
       .github/workflows/enrich-pardons.yml
git commit -m "chore: retire legacy Perplexity+GPT pardons enrichment (ADO-523)"
```

- [ ] **Step 5: Deploy to PROD**

Cherry-pick to deployment branch, PR to main. Standard deployment flow.

---

## Rollback Plan

If the agent produces garbage or goes down:

1. **Immediate (< 5 min):** Pause the trigger via claude.ai/code/scheduled
2. **Short-term:** Legacy scripts still exist until Task 6 completes. Re-enable workflows.
3. **Data recovery:** `pardons_enrichment_log` records which pardons were enriched per run. Reset those pardons to `enriched_at = NULL` and re-run old pipeline.

**Do NOT delete old scripts (Task 6) until 5+ days of clean PROD runs.**

---

## Cost Impact

| Item | Current | With Cloud Agent |
|------|---------|-----------------|
| Perplexity Sonar (pardons research) | ~$1.00/mo | $0 (eliminated) |
| GPT-4o-mini (pardons enrichment) | ~$0.50/mo | $0 (eliminated) |
| Claude subscription | (existing) | (existing, no change) |
| **Net savings** | | **~$1.50/month** |

The savings are modest — the real value is quality improvement (crime_description coverage, accurate corruption levels).

---

## Dependencies

| Dependency | Status | Blocks |
|-----------|--------|--------|
| PR #94 (auto-publish fix) | OPEN (mergeable, all checks pass) | Task 5 (PROD deploy) |
| ADO-516 Epic created | DONE | — |
| ADO-518-523 Stories created | DONE | — |
| Migration 094 | Task 1 | Task 3 (trigger needs log table) |
| Prompt v1 | Task 2 | Task 3 (trigger reads prompt) |
| TEST validation | Task 3 | Task 5 (PROD deploy) |

---

## Build Sequence

```
Task 1 (observability) ──→ Task 2 (prompt) ──→ Task 3 (trigger + validate)
                                                        ↓
                           Task 4 (admin verify) ───────┤
                                                        ↓
                                              Task 5 (PROD launch)
                                                        ↓
                                              Task 6 (retire legacy)
```

Tasks 1 and 4 can potentially run in parallel. Tasks 2→3 are sequential (prompt must exist before trigger). Task 5 requires 1-4 complete. Task 6 requires 5 stable for 5+ days.

---

## Review Log

| Date | Reviewer | Type | Findings |
|------|----------|------|----------|
| 2026-05-28 | Claude (feature-dev:code-reviewer) | Pattern compliance | 2 critical (RLS + skipped column), 5 important. All fixed. |
| 2026-05-28 | Claude (staff eng architecture) | Production readiness | 5 critical (admin validation bugs, NOT NULL constraints, missing columns), 7 important. All critical fixed in plan. |

**Critical fixes applied:**
1. RLS enabled on `pardons_enrichment_log` (matching 090/091 pattern)
2. `pardons_skipped` column added to log table schema
3. `corruption_reasoning` added to AGENT WRITES list
4. `enrichment_prompt_version` and `prompt_version` added to AGENT WRITES list
5. `enrichment_meta` added to AGENT WRITES list (EO parity)
6. `receipts_timeline` and `source_urls` marked as NOT NULL (must send `[]` not `null`)
7. Admin edge function bugs documented in Task 4 (corruption_level 0-5, missing connection types)
8. Cloud environment verification step added to Task 3

**Important items documented (fix during execution):**
- Gold set candidates need PROD ID verification (Task 2, Step 1)
- Web content security section needed in prompt (Task 2, Step 2)
- No `enrichment_status` state machine on pardons — using `enriched_at IS NULL` filter (acceptable for v1)
- Re-enrichment time estimate: ~4-6 hours with web research (longer than SCOTUS)
- PR #94 auto-publish fix applies to pardons via `is_public` column (same pattern as EO/SCOTUS)

---

**Created:** 2026-05-28
**Author:** Josh + Claude Code
**Status:** Reviewed — two-pass review complete, all critical findings addressed
**ADO Epic:** ADO-516
