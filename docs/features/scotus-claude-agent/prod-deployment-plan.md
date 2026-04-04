# SCOTUS Claude Agent — PROD Deployment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the tone-integrated SCOTUS Claude Agent to PROD so it enriches cases daily and Josh can manually review/publish them while the admin dashboard is built.

**Architecture:** Cherry-pick prompt files to main, apply 4 missing migrations to PROD DB, create a PROD cloud environment + trigger at claude.ai/code, enable daily cron schedule. Manual review workflow: agent runs daily -> Claude runs `/scotus-review` -> Josh approves -> Claude flips `is_public`.

**Tech Stack:** Supabase (PROD), Claude Cloud Triggers, GitHub (main branch)

---

## Context

- SCOTUS base schema (scotus_cases, scotus_opinions) **already exists on PROD** (deployed Feb 22, 18 migrations applied)
- 1,362 cases in PROD DB, 94 enriched (old pipeline), 51 published
- PROD Supabase project ref: `osjbulmltfpcoldydexg`
- TEST trigger: `trig_01S2xQVXfaB8rGJpbaPCWPvV` (DO NOT modify — keep for TEST)

## Who Does What

| Task | Who | Why |
|------|-----|-----|
| Apply migrations to PROD DB | **Josh** (Supabase Dashboard) | Claude can't access PROD Supabase MCP |
| Cherry-pick to main, create PR | **Claude** | Git operations |
| Create PROD cloud environment | **Josh** (claude.ai/code) | Requires browser UI |
| Create PROD trigger | **Claude** (RemoteTrigger API) | Needs environment ID from Josh |
| Enable daily cron | **Claude** (RemoteTrigger API) | After trigger verified |
| Review enriched cases | **Claude** (`/scotus-review`) | Automated quality gate |
| Approve/publish cases | **Josh** (tells Claude which to publish) | Human publish gate |

---

### Task 1: Apply Migrations to PROD Database

**Who:** Josh (Supabase Dashboard SQL Editor)
**Why:** 4 migrations created after the Feb 22 PROD deploy haven't been applied.

All use `IF NOT EXISTS` / `IF EXISTS` so they're safe to re-run.

- [ ] **Step 1: Open PROD Supabase SQL Editor**

Go to: Supabase Dashboard -> TrumpyTracker (PROD, ref `osjbulmltfpcoldydexg`) -> SQL Editor

- [ ] **Step 2: Verify what's already there**

Run this query to check which columns exist:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'scotus_cases'
  AND column_name IN (
    'substantive_winner', 'fact_extracted_at', 'fact_sources',
    'fact_review_status', 'is_merits_decision'
  )
ORDER BY column_name;
```

Also check if enrichment_log table exists:

```sql
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_name = 'scotus_enrichment_log'
);
```

- [ ] **Step 3: Apply Migration 087 — Compound dispositions**

```sql
-- Migration 087: Add compound disposition values
ALTER TABLE scotus_cases
DROP CONSTRAINT IF EXISTS scotus_cases_disposition_check;

ALTER TABLE scotus_cases
ADD CONSTRAINT scotus_cases_disposition_check
  CHECK (disposition IS NULL OR disposition IN (
    'affirmed', 'reversed', 'vacated', 'remanded',
    'reversed_and_remanded', 'vacated_and_remanded', 'affirmed_and_remanded',
    'dismissed', 'granted', 'denied', 'GVR', 'other'
  ));
```

- [ ] **Step 4: Apply Migration 088 — Scout live columns**

```sql
-- Migration 088: Scout live columns
ALTER TABLE scotus_cases ADD COLUMN IF NOT EXISTS substantive_winner TEXT;
ALTER TABLE scotus_cases ADD COLUMN IF NOT EXISTS fact_extracted_at TIMESTAMPTZ;
ALTER TABLE scotus_cases ADD COLUMN IF NOT EXISTS fact_sources TEXT[];
ALTER TABLE scotus_cases ADD COLUMN IF NOT EXISTS fact_review_status TEXT
  CHECK (fact_review_status IS NULL OR fact_review_status IN ('ok', 'needs_review', 'failed'));
```

- [ ] **Step 5: Apply Migration 089 — Merits classification**

```sql
-- Migration 089: Merits classification
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS is_merits_decision BOOLEAN DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_scotus_cases_merits_null
  ON scotus_cases(id) WHERE is_merits_decision IS NULL;
```

- [ ] **Step 6: Apply Migration 090 — Enrichment log table**

```sql
-- Migration 090: Enrichment log (agent observability)
CREATE TABLE IF NOT EXISTS scotus_enrichment_log (
    id BIGSERIAL PRIMARY KEY,
    ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed')),
    agent_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    prompt_version TEXT NOT NULL,
    cases_found INTEGER NOT NULL DEFAULT 0,
    cases_enriched INTEGER NOT NULL DEFAULT 0,
    cases_failed INTEGER NOT NULL DEFAULT 0,
    cases_skipped INTEGER NOT NULL DEFAULT 0,
    case_details JSONB DEFAULT '[]'::jsonb,
    errors JSONB DEFAULT '[]'::jsonb,
    run_source TEXT NOT NULL DEFAULT 'cloud-agent',
    duration_seconds INTEGER
);

CREATE INDEX IF NOT EXISTS idx_scotus_enrichment_log_ran_at
    ON scotus_enrichment_log (ran_at DESC);
```

- [ ] **Step 7: Verify all migrations applied**

```sql
-- Should return 5 rows (substantive_winner, fact_extracted_at, fact_sources, fact_review_status, is_merits_decision)
SELECT column_name FROM information_schema.columns
WHERE table_name = 'scotus_cases'
  AND column_name IN ('substantive_winner', 'fact_extracted_at', 'fact_sources', 'fact_review_status', 'is_merits_decision')
ORDER BY column_name;

-- Should return true
SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'scotus_enrichment_log');

-- Should show compound dispositions
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'scotus_cases'::regclass AND conname LIKE '%disposition%';
```

Tell Claude the results. If all 3 checks pass, Task 1 is done.

---

### Task 2: Cherry-Pick Prompt Files to Main

**Who:** Claude
**Depends on:** Nothing (can run in parallel with Task 1)

- [ ] **Step 1: Create deployment branch from main**

```bash
git checkout main
git pull origin main
git checkout -b deploy/scotus-agent-prod
```

- [ ] **Step 2: Cherry-pick the 6 prompt commits in order**

```bash
git cherry-pick 0a38469  # feat: enrichment log table + compound dispositions constraint
git cherry-pick 55a5225  # feat: SCOTUS cloud agent prompt v1
git cherry-pick fb53ef1  # fix: temp file pattern for curl JSON bodies
git cherry-pick a4e848d  # fix: anti-default-bias for vote split and authorship
git cherry-pick 72a59c4  # feat: tone integration + scotus-review skill
git cherry-pick f8091fc  # fix: code review findings (prompt_version v1.1, skill fixes)
```

If conflicts occur, resolve and continue. Likely clean since these files don't exist on main.

- [ ] **Step 3: Verify key files are present**

```bash
ls docs/features/scotus-claude-agent/prompt-v1.md
ls .claude/commands/scotus-review.md
ls migrations/090_scotus_enrichment_log.sql
```

- [ ] **Step 4: Push and create PR**

```bash
git push origin deploy/scotus-agent-prod
gh pr create --title "feat: SCOTUS Claude Agent prompt + enrichment log" --body "..."
```

- [ ] **Step 5: Merge PR once checks pass**

---

### Task 3: Create PROD Cloud Environment

**Who:** Josh (claude.ai/code browser UI)
**Depends on:** Task 1 (migrations must be applied first)

- [ ] **Step 1: Go to claude.ai/code -> Settings -> Environments**

- [ ] **Step 2: Create new environment**

| Field | Value |
|-------|-------|
| Name | `TTracker PROD` |
| Network access | Full |

- [ ] **Step 3: Add environment variables**

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | The PROD Supabase URL (starts with `https://osjbulmltfpcoldydexg...`) |
| `SUPABASE_SERVICE_ROLE_KEY` | The PROD service role key (from Supabase Dashboard -> Settings -> API) |

- [ ] **Step 4: Copy the environment ID and tell Claude**

The environment ID will look like `env_01XXXX...`. Claude needs this for Task 4.

---

### Task 4: Create PROD Trigger

**Who:** Claude (RemoteTrigger API)
**Depends on:** Task 2 (PR merged to main) + Task 3 (PROD environment ID)

- [ ] **Step 1: Create the trigger**

Claude will use `RemoteTrigger create` with:
- Name: `SCOTUS Enrichment Agent (PROD)`
- Environment: The PROD environment ID from Task 3
- Model: `claude-opus-4-6`
- Source repo: `https://github.com/AJWolfe18/TTracker`
- Bootstrap prompt: Same as TEST but with `git checkout main` instead of `git checkout -B test origin/test`

- [ ] **Step 2: Manual test run**

Claude will trigger one run and verify:
- Agent starts, reads prompt from main branch
- Connects to PROD Supabase
- Finds pending cases (if any) or logs "0 cases found"
- enrichment_log entry created on PROD with prompt_version = v1.1

- [ ] **Step 3: Verify by checking PROD DB**

Josh checks Supabase Dashboard for scotus_enrichment_log entries.

---

### Task 5: Enable Daily Schedule

**Who:** Claude (RemoteTrigger API)
**Depends on:** Task 4 (trigger verified working)

- [ ] **Step 1: Set cron schedule**

Claude will update the trigger with cron: `0 16 * * 1-5`
(4PM UTC = 11AM Chicago, weekdays only — 1 hour after SCOTUS typically releases opinions)

- [ ] **Step 2: Verify next_run_at is populated**

---

### Task 6: Establish Manual Review Workflow

**Who:** Claude + Josh (ongoing)
**Depends on:** Task 5 (daily schedule active)

The daily workflow until the admin dashboard (ADO-340) is built:

```
Agent runs daily at 4PM UTC
    |
    v
Claude runs:  /scotus-review latest
    |
    v
Claude posts review summary to Josh
    |
    v
Josh says: "publish 286, 120" or "hold 108 — check vote_split"
    |
    v
Claude flips is_public=true for approved cases
    |
    v
Cases appear on trumpytracker.com
```

- [ ] **Step 1: Agree on notification method**

Options:
- Claude checks after each daily run and posts review in next session
- Josh triggers `/scotus-review latest` manually when he wants to review

- [ ] **Step 2: Document the approval command**

Josh says: "publish [case IDs]"
Claude runs: `PATCH /scotus_cases?id=in.(<IDS>) SET is_public=true`

Josh says: "hold [case ID] — [reason]"
Claude adds reason to `low_confidence_reason` and keeps `is_public=false`

---

## Rollback Plan

If the PROD agent produces bad enrichment:

1. **Disable trigger:** Claude sets `enabled: false` via RemoteTrigger API
2. **Revert bad enrichments:** `PATCH /scotus_cases?enrichment_status=eq.enriched&enriched_at=gt.[BAD_RUN_TIME] SET enrichment_status='pending', is_public=false`
3. **Investigate:** Check `scotus_enrichment_log` for the bad run's `case_details` and `errors`

No cases go public without Josh's explicit approval, so bad enrichments never reach the frontend.

---

## Cost Impact

| Item | Cost |
|------|------|
| Claude Cloud Agent (Opus, daily) | $0 (included in subscription) |
| Supabase PROD queries | $0 (within free tier, ~5 cases/day) |
| Old pipeline retirement | -$20/month (eliminates OpenAI/Perplexity calls) |
| **Net change** | **-$20/month savings** |

---

## Checklist Before Going Live

- [ ] Migrations 087-090 applied to PROD and verified
- [ ] PR merged to main with prompt-v1.md
- [ ] PROD cloud environment created with correct Supabase credentials
- [ ] PROD trigger created and test run successful
- [ ] enrichment_log shows completed run on PROD
- [ ] Daily cron enabled
- [ ] First batch of cases reviewed with `/scotus-review` and approved by Josh
