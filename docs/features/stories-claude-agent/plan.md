# Stories Claude Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GPT-4o-mini inline story enrichment (severity-saturated, 67% of live stories rated "severe"/"critical") with a batched Claude Code cloud agent, on the same architectural pattern already proven for SCOTUS, EOs, and Pardons.

**Architecture:** Split clustering from enrichment. Clustering (dedup, entity matching, story creation) stays inline in `rss-tracker-supabase.js`, runs every 2 hours, unchanged — it is not the source of the quality problem and needs to stay fast for freshness. Enrichment (AI summaries, category, alarm_level) moves out to a Claude Sonnet cloud agent that runs on the same 2-hour cadence, reads pending stories via Supabase PostgREST (direct HTTP, no MCP), and writes enrichment fields in a single reasoning pass. The frontend already hides un-enriched stories (`stories-active` edge function filters `summary_neutral IS NOT NULL`, TTRC-119) — that gate is reused as-is; no frontend code changes are required.

**Tech Stack:** Claude Sonnet (Anthropic cloud scheduled agent), Supabase PostgREST (direct HTTP via curl — same pattern as `docs/features/eo-claude-agent/prompt-v1.md`)

## Global Constraints

- Budget: <$50/month hard limit, project-wide (`CLAUDE.md`)
- Work on `test` branch; PROD via cherry-pick + PR only; never push `origin main` directly
- No Python — Node.js/JavaScript only
- No em dashes in AI-generated editorial content — hyphens, periods, or rewrite
- All AI editorial output MUST comply with `public/shared/tone-system.json` v2.0 (banned openings, banned phrases, banned patterns, writing rules) — this is enforcement, not documentation
- OFFSET pagination is banned — cursor-based only (not applicable to this feature, no new paginated endpoints)
- DB migrations applied manually via Supabase SQL Editor or MCP; never via `scripts/apply-migrations.js` (that helper only touches migration 009)

---

## Why This Route

### The Problem We're Solving

Checked severity/alarm_level distribution on the 200 most recently created stories on PROD (2026-06-30):

| alarm_level | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| count | 1 | 24 | 39 | **111** | **20** |

**67% of stories are rated "severe" or "critical" (alarm_level 4-5).** That is not a plausible distribution for daily political news coverage. This is the same failure shape as the EO pipeline's pre-fix 88% level-4 saturation (`docs/decisions/0001-claude-agents-over-gpt-pipelines.md`) — a small model (GPT-4o-mini) defaulting to the scariest available label instead of earning it with evidence. Josh's direct read on the current output: "the quality of the ratings and the stories are shit." The saturation data confirms it's not just a perception problem.

Two months of prompt iteration on the SCOTUS GPT pipeline did not fix an equivalent failure mode there. The org's own conclusion (ADR 0001): small-model failure modes like level saturation "don't respond reliably to prompt rules; the model 'knows' the rule but drifts anyway." SCOTUS and EO were both fixed by replacing the model and consolidating fact+editorial into one reasoning pass, not by further prompt tuning on GPT-4o-mini. Stories gets the same fix.

### Why Not a QA-Agent Overlay Instead

Considered and rejected: keep GPT-4o-mini for real-time first-pass enrichment, add a periodic Claude agent that reviews and corrects miscalibrated stories after publish. This is structurally the same shape as `scotus-qa-layer-b.js` — the "second LLM reviews the first LLM's output" layer that SCOTUS's own migration explicitly replaced, not kept, because it didn't reliably catch drift. The decision doc's stated conclusion: "No separate QA LLM needed — the reasoning model IS the quality layer." A QA overlay on Stories would rebuild the exact component already proven not to hold up. Full replacement (this plan) is the only option consistent with that precedent.

### What We're Replacing

| Component | File | Status |
|-----------|------|--------|
| `enrichStory()` (GPT-4o-mini chat completion) | `scripts/enrichment/enrich-stories-inline.js` | Retired (kept as 60-day cold standby, not deleted) |
| `enrichStories()` / `enrichAndBillStory()` call site | `scripts/rss-tracker-supabase.js` | Gated off behind kill switch (Task 2) |
| Stories `SYSTEM_PROMPT` | `scripts/enrichment/prompts.js` | Retired |
| Frame-based variation pool system (ADO-273/274) | `scripts/enrichment/stories-style-patterns.js` | Retired — the Claude agent varies its own openings organically per the tone-system rules, same as the EO agent does; no deterministic pool selection needed |
| Daily OpenAI story-enrichment budget guard (`increment_budget_with_limit` calls for stories) | `scripts/rss-tracker-supabase.js` | No longer invoked for stories (Claude cloud agent has $0 marginal cost, no per-story budget check needed — same as SCOTUS/EO/Pardons) |

### What We're Keeping (unchanged)

| Component | Why |
|-----------|-----|
| `hybrid-clustering.js`, `extract-article-entities-inline.js` | Clustering is not the quality problem. Stays inline, every 2 hours, no AI-editorial content generated here. |
| OpenAI embeddings (`EMBEDDING_MODEL_V1`) used during clustering | **Different from enrichment.** Embeddings are a cheap, non-LLM similarity signal used for article-to-story matching, not editorial content. Not in scope for this migration — clustering keeps its OpenAI client for embeddings only. |
| `stories-active` edge function's `.not('summary_neutral', 'is', null)` gate (TTRC-119) | Already implements "hide until enriched" — reused as the publish gate for this project. No frontend change needed. |
| `needs_review` / `review_reason` auto-flag trigger (migration 080) | Independent admin-dashboard mechanism (flags thin/low-confidence/failed enrichments). Orthogonal to this migration — the Claude agent's writes will pass through it same as GPT's did. |
| `rss-tracker-prod.yml` schedule (every 2 hours) | Clustering keeps this cadence unchanged. |

### Decisions Already Made (2026-06-30, with Josh)

| # | Decision | Resolution |
|---|----------|-----------|
| 1 | Publish gating while a story awaits enrichment | **Hide until enriched.** Matches the exact SCOTUS/EO/Pardons pattern already in prod. Reuses the existing `summary_neutral IS NOT NULL` gate — no new column, no frontend work. |
| 2 | Cadence | **Every 2 hours**, matching the RSS clustering cadence, to keep the "hide until enriched" latency close to what readers see today (worst case ~2.5 hrs vs today's ~60 sec) instead of SCOTUS's once-daily cadence. |
| 3 | GPT-4o-mini elimination | Full replacement (Option A), not a QA overlay (Option B) — see "Why Not a QA-Agent Overlay" above. |
| 4 | Historical backlog reprocessing | **Deferred, out of scope for this plan.** The ~67%-severe backlog of already-GPT-enriched stories stays as-is; this plan only fixes enrichment going forward. If/when Josh wants those relabeled, that's a separate bulk job scoped later (see Open Questions #1) — not a blocker for Tasks 1-7 below. |

---

## Architecture Diagram

```
RSS Feeds
    ↓ (every 2 hours — UNCHANGED — cron '0 */2 * * *')
rss-tracker-prod.yml → rss-tracker-supabase.js
    ├── Fetch feeds, extract entities, cluster articles into stories (UNCHANGED)
    ├── New stories land with summary_neutral = NULL (invisible on frontend, TTRC-119 gate)
    └── enrichStories() call REMOVED (gated off — see Task 2)
    ↓
    ↓ (new: every 2 hours, offset 30 min — cron '30 */2 * * *')
    ↓
Claude Agent (Sonnet, Anthropic cloud)
    ├── Connects: Supabase PostgREST via curl (service key from Cloud Environment env vars)
    ├── Checks: stories_enrichment_log for overlapping runs
    ├── Reads: GET stories WHERE status=active AND (last_enriched_at IS NULL OR < 12h ago), joined to article_story!inner (excludes orphan stories)
    ├── Reads: GET article_story + articles for up to 6 source articles per story
    ├── Reasons: single-pass summary + category + alarm_level + entities, in "The Chaos" voice
    ├── Validates: internal checklist before each write (tone-system compliance, alarm-level discipline)
    ├── Writes: PATCH stories (summary_neutral populated → story becomes visible via existing gate)
    ├── Logs: POST/PATCH stories_enrichment_log (status running → completed/failed)
    └── Never sets qa_status or needs_review directly — the existing trigger (migration 080) handles that from row content
    ↓
Frontend (stories-active edge function) — UNCHANGED, already filters summary_neutral IS NOT NULL
```

---

## Schedule

- **Clustering (`rss-tracker-prod.yml`):** unchanged, `0 */2 * * *` (every 2 hours, on the hour)
- **Stories Claude Agent:** new, `30 */2 * * *` (every 2 hours, 30 minutes past — mirrors the SCOTUS pattern of running after its upstream step, scaled down from SCOTUS's 1-hour gap since Stories' cadence is 12x tighter)
- **Dependency:** the agent processes whatever matches the Step 2 query (`last_enriched_at IS NULL` or stale, joined to `article_story!inner`) at run time — if clustering is still mid-run when the agent fires, those stories simply get picked up on the *next* 2-hour cycle. No hard failure mode from the 30-minute buffer being too short; worst case is one extra 2-hour cycle of latency for a story clustered in the last few minutes before the agent runs.
- **Batch size:** `limit=40` per run. At ~62 stories/day average (7-day range: 22-76) over 12 runs/day, expected load is ~5-8 stories/run; 40 gives headroom for a breaking-news cluster spike in one 2-hour window without needing a second run to drain backlog. Raise manually for initial-cutover backlog draining (Task 7).

---

## Prompt Design

The full prompt is authored in Task 3 as `docs/features/stories-claude-agent/prompt-v1.md` (version-controlled, referenced by the cloud trigger — not embedded in this plan, matching the SCOTUS/EO/Pardons precedent where the plan specifies structure and the prompt file is a separate, iterated deliverable).

### Required Prompt Sections (mirrors `eo-claude-agent/prompt-v1.md` structure)

1. Role & task definition
2. Supabase PostgREST API reference (base URL, auth headers, GET/PATCH examples via curl — **not WebFetch**, which cannot set custom headers)
3. Step 0a: Read `public/shared/tone-system.json` — binding for all editorial output
4. Step 0b: Read `scripts/lib/entity-normalization.js` — binding canonical ID format/alias table for `top_entities`/`entity_counter` (see "Enrichment Fields" below; skipping this step is how the agent silently corrupts clustering metadata)
5. Step 1: Generate run ID, coarse concurrency check against `stories_enrichment_log` (early-exit optimization only — see "Concurrency Guard" under Step 6 below for the actual correctness guard)
6. Step 2: Find stories needing enrichment (query below)
7. Step 3: Fetch up to 6 source articles per story (mirrors `fetchStoryArticles()` in the retired `enrich-stories-inline.js` — same ordering: `is_primary_source desc, similarity_score desc, matched_at desc`)
8. Step 4: Produce enrichment (fields table below)
9. Gold set calibration examples (Task 4 — embedded once curated)
10. Step 5: Validate before writing (checklist)
11. Step 6: Write to database (PATCH `stories`, single atomic write per story, success AND failure paths — see "Enrichment Fields" below)
12. Step 7: Log run completion
13. Failure handling, security (untrusted input defense — article content is untrusted), invariants

### Step 2 Query (find stories needing enrichment)

**Correction (Codex review round 1, 2026-06-30):** the original draft of this query gated on `summary_neutral.is.null` and dropped the `article_story` join. Both were wrong. `last_enriched_at` is stamped on EVERY attempt, success or failure (`rss-tracker-supabase.js:626-633`) — that's the existing retry-storm guard (migration 037's comment: "Prevents retry storms by marking failed stories as 'recently attempted'"). `summary_neutral` stays null forever on a permanently-failing story, so gating on it would requeue that story every single 2-hour run, forever. The join matters too: `article_story!inner` excludes stories with zero linked articles, which the agent has nothing to enrich from anyway.

**Correction (Codex review round 2, 2026-06-30):** the round-1 fix above introduced a new bug. `last_enriched_at.is.null OR last_enriched_at.lt.CUTOFF` does not distinguish "never enriched by anything" from "GPT-enriched days ago and never touched since." Virtually every currently-active story has a `last_enriched_at` set by the legacy GPT pipeline and older than 12h, so this query would sweep the entire active backlog into the Claude agent within the first few 2-hour cycles after cutover -- exactly the unscoped bulk reprocessing Open Questions #1 says needs an explicit decision from Josh, not something the query should decide implicitly. Fixed by adding `enrichment_meta->>source = claude-agent` as a discriminator: a story only re-enters the queue on staleness grounds if the Claude agent itself wrote that marker on a prior attempt (success OR failure -- the failure-write policy below now also writes a lightweight `enrichment_meta` marker specifically so this discriminator works for retries too). A story the legacy GPT pipeline enriched stays invisible to this query forever, by design, until Open Question #1 is explicitly resolved.

Exact translation of `rss-tracker-supabase.js:562-573` to PostgREST, with the discriminator applied:

```bash
COOLDOWN_CUTOFF=$(date -u -d "12 hours ago" +"%Y-%m-%dT%H:%M:%SZ")

curl -s "${SUPABASE_URL}/rest/v1/stories?status=eq.active&or=(last_enriched_at.is.null,and(enrichment_meta-%3E%3Esource.eq.claude-agent,last_enriched_at.lt.${COOLDOWN_CUTOFF}))&select=id,primary_headline,last_enriched_at,enrichment_failure_count,enrichment_meta,article_story!inner(article_id)&order=last_enriched_at.asc.nullsfirst&limit=40" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

(`-%3E%3E` is URL-encoded `->>`, needed inside the `or=(...)` composite filter value.)

This query correctly covers three cases:
1. **Truly never enriched** (`last_enriched_at IS NULL`) - first-time clustering output, always eligible.
2. **Claude-agent-enriched, now stale** (`enrichment_meta->>source = claude-agent` AND `last_enriched_at < 12h ago`) - the existing re-enrichment-as-cluster-grows behavior, scoped to the Claude agent's own prior output only.
3. **Claude-agent attempt failed, cooldown passed** - same branch as #2, since failures now also write the `source: claude-agent` marker (failure-write policy in the Enrichment Fields table below). Retries after 12h, same cadence as success-path re-enrichment.

**What this deliberately excludes:** any story whose `enrichment_meta` was written by the legacy GPT pipeline (`model: gpt-4o-mini`, no `source: claude-agent` key). Those stories keep their existing GPT-written content, frozen, until Open Question #1 is resolved and someone explicitly nulls `last_enriched_at`/`enrichment_meta` on the targeted rows to make them match branch #1 again.

**If 0 stories are returned (Codex review round 3, 2026-06-30 — deviates from the EO/SCOTUS pattern, deliberately):** EO/SCOTUS leave zero log rows on a healthy empty run and treat that as fine, because they run once a day. Stories runs every 2 hours, so a genuinely healthy string of zero-candidate cycles (overnight, or right after a previous run just cleared the backlog) is common, not rare — and with a per-story-only log table, that would be indistinguishable from the agent having stopped running. Insert one heartbeat row before stopping:

```json
{"story_id": null, "prompt_version": "claude-v1", "run_id": "<RUN_ID>", "status": "completed", "notes": "Healthy empty run - 0 candidates found"}
```

This is the only case where the agent inserts a row with `story_id: null`. Every other log row (one per story processed, success or failure) has a real `story_id`.

`article_story!inner(article_id)` in the `select` performs the same inner-join filtering PostgREST-side as Supabase JS's `.select('...,  article_story!inner(article_id)')` — rows with no matching `article_story` record are excluded from the result entirely, not just nulled out.

This preserves the existing re-enrichment behavior (a story whose cluster grows with new articles gets refreshed after 12 hours), not just first-time enrichment, and preserves the existing failure-retry cooldown (a story that failed 10 minutes ago will not be picked up again until the 12h cooldown passes — same as today).

### Enrichment Fields (what the agent writes)

| Field | Type | Guidance |
|-------|------|----------|
| `summary_neutral` | text | 2-3 sentences, neutral, no editorial framing. Populating this is what makes the story visible (TTRC-119 gate) — never write a placeholder. |
| `summary_spicy` | text | "The Chaos" voice editorial summary. Tone calibrated to `alarm_level` per `tone-system.json` `toneCalibration` object (already defines all 6 levels — reuse verbatim, don't reinvent). |
| `category` | text | One of the existing 11 DB enum values (see `UI_TO_DB_CATEGORIES` in the retired `enrich-stories-inline.js` for the exact list: `corruption_scandals`, `democracy_elections`, `policy_legislation`, `justice_legal`, `executive_actions`, `foreign_policy`, `corporate_financial`, `civil_liberties`, `media_disinformation`, `epstein_associates`, `other`) |
| `alarm_level` | smallint 0-5 | **Anti-default-bias rule, non-negotiable:** start at 2, earn every upgrade with specific evidence from the source articles. Never default to 4. See calibration ladder below. |
| `severity` | text | Derived, not independently chosen: 5→`critical`, 4→`severe`, 3→`moderate`, 2→`minor`, 0-1→`null`. Must match `alarmLevelToLegacySeverity()` in `stories-style-patterns.js:716-723` exactly — this is a DB CHECK constraint, not a style choice. |
| `primary_actor` | text or null | The named person/org most central to the story, if identifiable. Do not invent one. |
| `top_entities`, `entity_counter` | text[], jsonb | **Must be canonical IDs, not free-form names.** Read `scripts/lib/entity-normalization.js` in full before extracting entities. Format: `US-LASTNAME` (people, e.g. `US-TRUMP`), `[CC]-LASTNAME` (international, e.g. `RU-PUTIN`), `ORG-ABBREV` (e.g. `ORG-DOJ`), `LOC-NAME` (e.g. `LOC-USA`), `EVT-NAME` (e.g. `EVT-JAN6`). Check the `ENTITY_ALIASES` table for the correct canonical form of any named person/org before inventing an ID — do not emit an ID that isn't in `ENTITY_ALIASES` AND doesn't match one of the five regex patterns in `VALID_ID_PATTERNS`. Never emit an ID present in the `BAD_IDS` blocklist (overly generic IDs like `ORG-GOVERNMENT`, `US-CITIZENS`). Dedup `top_entities` (stable, order by confidence desc) and build `entity_counter` as `{id: count}` — same shape `toTopEntities()` / `buildEntityCounter()` in the retired `enrich-stories-inline.js:139-170` produce, just computed by the agent instead of that JS helper. |
| `last_enriched_at` | timestamptz | ISO 8601, not `NOW()`. **Write this on every attempt, success or failure** — this is the existing retry-storm guard (see Step 2 above); a story the agent could not enrich still gets `last_enriched_at` stamped so it isn't picked up again until the 12h cooldown passes. |
| `enrichment_status` | text or null | `null` on success (matches the currently-live convention in `enrich-stories-inline.js:386`, not the older `'success'` string `job-queue-worker.js` used — `admin-stories/index.ts:116-126`'s enriched-filter already treats null as enriched). Leave `null` on failure too — the admin dashboard's failed-bucket filter keys off `enrichment_failure_count > 0`, not this field. |
| `enrichment_failure_count` | integer | On success: `0`. On failure: increment the value returned by the Step 2 query for that story (`current_count + 1`) — never blindly set to `1`, or a story's failure history resets every run. |
| `last_error_category`, `last_error_message` | text or null | On success: both `null` (clears any prior failure). On failure: short category string (e.g. `no_source_articles`, `fetch_failed`, `write_failed`) and a truncated (≤500 char) human-readable reason. Matches `enrich-single-story.js:89-94`'s existing convention — this is what the admin dashboard's failed-stories queue reads. |
| `enrichment_meta` | jsonb | `{"prompt_version": "claude-v1", "model": "claude-sonnet-4-6", "enriched_at": "<iso>", "source": "claude-agent"}` — this string discriminates Claude-agent output from any historical GPT output for reporting purposes. |

### Concurrency Guard (required, not optional)

**Why:** two agent runs can overlap — a manual test run firing while the 2-hourly cron is also running, for example. The Step 1 log check doesn't stop this: `stories_enrichment_log` is per-story, so both runs can see "nobody's working on this one" and both proceed to enrich the same story. EO gets away with the same race because a DB trigger rejects whichever write lands second. Stories has no such trigger, so a lost race here would silently overwrite content instead of failing loudly.

**Fix:** make every write conditional on the story not having changed since it was read. Every Step 6 PATCH includes the story's `last_enriched_at` value from Step 2 as a filter:

- If it was `null` → `&last_enriched_at=is.null`
- If it had a timestamp → `&last_enriched_at=eq.<that exact timestamp>`

```bash
curl -s -X PATCH "${SUPABASE_URL}/rest/v1/stories?id=eq.${STORY_ID}&last_enriched_at=is.null" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d @/tmp/patch-story-${STORY_ID}.json
```

If another run already wrote to this story first, `last_enriched_at` has changed, so this PATCH matches zero rows and returns `[]` — the same "empty response" signal the prompt already treats as a write failure (Step 7). Log it as `concurrent_write_lost` and move on, no retry this run. It's not really an error — the other run just won the race — but it has to show up in the log, or two runs racing would look like one clean success.

**Never write:** `id`, `story_hash`, `created_at`, `first_seen_at`, `status`, `article_count`, `primary_headline` — all owned by clustering. Never write `needs_review` / `review_reason` / `reviewed_at` / `reviewed_by` directly — migration 080's trigger derives `needs_review` from row content (summary length, confidence score, failure count) automatically on every UPDATE; the agent should not fight that trigger by setting it manually. (`enrichment_status` / `enrichment_failure_count` / `last_error_category` / `last_error_message` are NOT in this never-write list — see the table above; the admin dashboard depends on the agent maintaining them.)

### Alarm Level Calibration Ladder (adapted from the EO agent's proven anti-saturation rules)

Same discipline that fixed EO's 88%→calibrated distribution, adapted to Stories' "dumpster fire" framing:

- **Start at 2. Earn every upgrade with specific evidence.** A dramatic headline is not evidence — the concrete mechanism, named actor, and measurable consequence are evidence.
- **Upgrade to 3** only if: named institutional actor engaged in a real but survivable pattern of corruption/spin (the "Deep Swamp" / "Great Gaslight" territory)
- **Upgrade to 4** only if: named actor + concrete, non-speculative criminal or constitutional harm, not just alleged/rumored
- **Upgrade to 5** only if: verified constitutional-crisis-scale event — courts defied, elections subverted, direct attack on institutional legitimacy with immediate effect
- **If your first three stories all come out at level 4, stop and re-examine each one** — this is the exact failure mode measured in production today (67% at 4-5).

### Voice: "The Chaos" (from `tone-system.json`, verbatim — do not redefine)

- **Framing:** "Look at this specific dumpster fire inside the larger dumpster fire."
- **Labels by level** (spicy / neutral): 5 = Constitutional Dumpster Fire / Constitutional Crisis, 4 = Criminal Bullshit / Criminal Activity, 3 = The Deep Swamp / Institutional Corruption, 2 = The Great Gaslight / Misleading-Spin, 1 = Accidental Sanity / Mixed Outcome, 0 = A Broken Clock Moment / Positive Outcome
- **Profanity:** allowed only at levels 4-5 (`profanityAllowed` in tone-system.json)
- **Tone calibration by level:** reuse `toneCalibration` object verbatim (ALARM BELLS at 5, down to SUSPICIOUS CELEBRATION at 0) — same six-level scale shared across all four domains, already written, do not duplicate or rephrase in the prompt
- **Banned openings / phrases / patterns:** shared `bannedOpenings` (31), `bannedPhrases` (19+), `bannedPatterns` — binding, read from the file at Step 0, not copy-pasted into the prompt (so future tone-system edits don't require a prompt re-issue)

---

## Observability

### Task 1: `stories_enrichment_log` Migration

**Files:**
- Create: `migrations/098_stories_enrichment_log.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration: 098_stories_enrichment_log.sql
-- Purpose: Observability table for the Stories Claude Agent (mirrors 091_executive_orders_enrichment_log.sql)
-- Tracks every enrichment attempt: prompt version, status, timing.
--
-- DEPENDENCY: stories table must exist (stories.id is BIGSERIAL / bigint on both TEST and PROD —
-- unlike executive_orders, there is no PROD/TEST id-type drift here).
--
-- story_id is NULLABLE, unlike EO's equivalent table (executive_orders_enrichment_log.eo_id is NOT NULL).
-- EO/SCOTUS leave zero log rows on a healthy 0-found run, which is fine at their once-daily cadence.
-- Stories runs every 2 hours; several consecutive healthy 0-candidate cycles are plausible (overnight
-- lulls), and with a per-story-only log, that would look identical to the agent not running at all —
-- a monitoring false-alert (Codex review round 3, 2026-06-30). NULL story_id = a run-level heartbeat
-- row written when Step 2 finds 0 candidates, so "last completed row" stays a reliable run-health signal
-- regardless of candidate volume.

CREATE TABLE IF NOT EXISTS stories_enrichment_log (
    id BIGSERIAL PRIMARY KEY,
    story_id BIGINT REFERENCES stories(id) ON DELETE CASCADE,  -- NULL = run-level heartbeat, no candidates found
    prompt_version TEXT NOT NULL,
    run_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed')),
    duration_ms INTEGER,
    needs_manual_review BOOLEAN NOT NULL DEFAULT false,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Most recent enrichment runs first (admin dashboard, monitoring queries)
CREATE INDEX IF NOT EXISTS idx_stories_enrichment_log_created_at
    ON stories_enrichment_log (created_at DESC);

-- Per-story enrichment history (admin dashboard drill-down)
CREATE INDEX IF NOT EXISTS idx_stories_enrichment_log_story_id_created_at
    ON stories_enrichment_log (story_id, created_at DESC);

-- Enable RLS — service_role bypasses RLS automatically, so agent writes work.
-- Without RLS, the anon key (public) could read run logs.
ALTER TABLE stories_enrichment_log ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply migration to TEST**

Run via Supabase MCP `execute_sql` (project ref `wnrjrywpcadwutfykflu`) or the SQL Editor.

- [ ] **Step 3: Verify table exists**

Query via MCP: `GET /stories_enrichment_log?select=count` — expect empty table, no error.

- [ ] **Step 4: Commit**

```bash
git add migrations/098_stories_enrichment_log.sql
git commit -m "feat: add stories_enrichment_log table for Stories Claude Agent observability"
```

### Monitoring Query

Relies on the zero-candidate heartbeat row (Step 2, above) to stay accurate — without it, this query would false-alert during any legitimate string of empty cycles, since `stories_enrichment_log` is otherwise per-story only.

```sql
-- Alert if no successful run in the last 3 hours (2hr cadence + 1hr grace)
SELECT CASE
    WHEN MAX(created_at) < NOW() - INTERVAL '3 hours'
    THEN 'ALERT: Stories Claude Agent has not run in 3+ hours'
    ELSE 'OK: Last run ' || MAX(created_at)::text
END AS status
FROM stories_enrichment_log
WHERE status = 'completed';
```

---

## Task 2: Gate Off the Legacy GPT Enrichment Call

**Files:**
- Modify: `scripts/rss-tracker-supabase.js:690-719` (the `run()` method)

This is a minimal, reversible change — gate the call behind a kill-switch env var defaulting to off, same rollback pattern SCOTUS used for its legacy pipeline (`vars.ENABLE_LEGACY_ENRICHMENT`). Do **not** delete `enrichStories()`, `enrichAndBillStory()`, or `scripts/enrichment/enrich-stories-inline.js` yet — 60-day cold standby, same as the SCOTUS/EO precedent (see Task 7).

- [ ] **Step 1: Add the kill switch around the call site**

Current code (`scripts/rss-tracker-supabase.js:690-719`):

```javascript
  async run() {
    try {
      // TTRC-321 Phase 0: Set global run start for diagnostic logging
      globalThis.__RUN_START__ = new Date();

      // ... (feed fetch, entity extraction phases unchanged) ...

      await this.extractArticleEntitiesPhase();

      // 4. Cluster articles using hybrid scoring (TTRC-299)
      await this.clusterArticles();

      // 5. Enrich stories with AI summaries
      await this.enrichStories();

      // 6. Log final stats
      await this.finalizeRunStats();
```

New code:

```javascript
  async run() {
    try {
      // TTRC-321 Phase 0: Set global run start for diagnostic logging
      globalThis.__RUN_START__ = new Date();

      // ... (feed fetch, entity extraction phases unchanged) ...

      await this.extractArticleEntitiesPhase();

      // 4. Cluster articles using hybrid scoring (TTRC-299)
      await this.clusterArticles();

      // 5. Enrich stories with AI summaries
      // Stories Claude Agent (docs/features/stories-claude-agent/) now owns enrichment,
      // running on its own 2-hour cloud-agent cron. Legacy GPT-4o-mini path kept as a
      // 60-day cold-standby rollback — re-enable only if the Claude agent needs to be
      // paused. Story rows created by clustering stay invisible (summary_neutral IS NULL,
      // TTRC-119 gate) until either path enriches them.
      if (process.env.ENABLE_LEGACY_STORY_ENRICHMENT === 'true') {
        console.log('⚠️  ENABLE_LEGACY_STORY_ENRICHMENT=true — running retired GPT enrichment path');
        await this.enrichStories();
      }

      // 6. Log final stats
      await this.finalizeRunStats();
```

- [ ] **Step 2: Wire the kill switch into both workflows as a GitHub Actions variable**

**Correction (Codex review, 2026-06-30):** the original draft of this step assumed the rollback plan (Task 2, "Rollback Plan" below) could flip `ENABLE_LEGACY_STORY_ENRICHMENT=true` without any workflow change. Verified against `rss-tracker-prod.yml:32-40` and `rss-tracker-test.yml:31-39` — neither env block passes this variable through, so `process.env.ENABLE_LEGACY_STORY_ENRICHMENT` would be `undefined` in every run, always taking the "off" branch, with no way to flip it without a code change. That defeats the purpose of a kill switch (instant rollback with no deploy). Wire it through explicitly, using the `vars` context (a GitHub repo/environment variable, toggleable in the GitHub UI under Settings → Secrets and variables → Actions → Variables — same mechanism the SCOTUS/EO kill switches use, e.g. `vars.ENABLE_LEGACY_ENRICHMENT`), not a hardcoded value:

Modify `.github/workflows/rss-tracker-prod.yml` (the "Run RSS Tracker (PROD)" step env block, currently lines 33-38):

```yaml
      - name: Run RSS Tracker (PROD)
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          ENVIRONMENT: prod
          RSS_TRACKER_RUN_ENABLED: 'true'  # KILL SWITCH: Set to 'false' to disable automation
          ENABLE_LEGACY_STORY_ENRICHMENT: ${{ vars.ENABLE_LEGACY_STORY_ENRICHMENT }}  # KILL SWITCH: set repo variable to 'true' to re-enable retired GPT enrichment path
        run: node scripts/rss-tracker-supabase.js
        timeout-minutes: 5
```

Modify `.github/workflows/rss-tracker-test.yml` (the "Run RSS Tracker (TEST)" step env block, currently lines 32-37) identically:

```yaml
      - name: Run RSS Tracker (TEST)
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_TEST_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_TEST_SERVICE_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          ENVIRONMENT: test
          RSS_TRACKER_RUN_ENABLED: 'true'
          ENABLE_LEGACY_STORY_ENRICHMENT: ${{ vars.ENABLE_LEGACY_STORY_ENRICHMENT }}
        run: node scripts/rss-tracker-supabase.js
        timeout-minutes: 5
```

With no repo variable set, `vars.ENABLE_LEGACY_STORY_ENRICHMENT` evaluates to an empty string, which still fails the `=== 'true'` check in Task 2 Step 1's code — off by default, same as before, but now actually flippable without a commit.


- [ ] **Step 3: Test locally against TEST**

```bash
ENVIRONMENT=test SUPABASE_URL=$SUPABASE_TEST_URL SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_TEST_SERVICE_KEY OPENAI_API_KEY=$OPENAI_API_KEY node scripts/rss-tracker-supabase.js
```

Expected: log output shows clustering phases running, but no `🤖 Enriching N stories...` line (that log line only appears inside `enrichStories()`, which the kill switch now skips by default). Confirm via Supabase MCP that newly clustered TEST stories have `summary_neutral = null` and no `total_openai_cost_usd` increase attributable to story enrichment (embeddings cost is unaffected and expected). Then re-run with `ENABLE_LEGACY_STORY_ENRICHMENT=true` in the local env to confirm the rollback branch still works end to end.

- [ ] **Step 4: Commit**

```bash
git add scripts/rss-tracker-supabase.js .github/workflows/rss-tracker-prod.yml .github/workflows/rss-tracker-test.yml
git commit -m "feat: gate legacy GPT story enrichment behind kill switch (Stories Claude Agent takes over)"
```

---

## Task 3: Write the Agent Prompt v1

**Files:**
- Create: `docs/features/stories-claude-agent/prompt-v1.md`

- [ ] **Step 1: Read the full retired prompt for baseline field/category coverage**

`scripts/enrichment/prompts.js` (stories `SYSTEM_PROMPT`) — extract the current category list, entity extraction instructions, and any legitimate calibration logic worth preserving (the ADO-270 alarm_level 0-5 introduction itself was fine; the problem is the model didn't reliably follow it, not that the scale is wrong).

- [ ] **Step 2: Read `public/shared/tone-system.json` and `scripts/lib/entity-normalization.js` in full**

Tone system: confirm the exact `labels.stories`, `toneCalibration`, `profanityAllowed`, `bannedOpenings`, `bannedPhrases`, `bannedPatterns`, `writingRules` values to reference (not duplicate) in the prompt — same approach as `eo-claude-agent/prompt-v1.md` Step 0.

Entity normalization: confirm the exact `ENTITY_ALIASES` table, `VALID_ID_PATTERNS` (5 regexes: `US-*`, `[CC]-*`, `ORG-*`, `LOC-*`, `EVT-*`), and `BAD_IDS` blocklist to reference in the prompt's entity-extraction instructions (Step 0b in "Required Prompt Sections" above). This file has no existing analog in the EO/SCOTUS/Pardons prompts — those domains don't write `top_entities`/`entity_counter` at all, so this is Stories-specific and needs its own prompt section, not a borrowed one.

- [ ] **Step 3: Write the full prompt**

Follow the "Required Prompt Sections" and "Enrichment Fields" tables above. Use `eo-claude-agent/prompt-v1.md` as the structural template for: PostgREST API reference block, JSON body construction via temp file (avoids shell-quoting breakage on apostrophes in article text — same risk here as EO order text), timestamp handling, array/jsonb field formatting, and the Step 5 validate-before-write checklist pattern.

**Column governance to make explicit in the prompt** (mirrors EO's WRITE / NEVER-WRITE lists):

AGENT WRITES on success: `summary_neutral`, `summary_spicy`, `category`, `alarm_level`, `severity`, `primary_actor`, `top_entities`, `entity_counter`, `last_enriched_at`, `enrichment_meta`, `enrichment_status` (`null`), `enrichment_failure_count` (`0`), `last_error_category` (`null`), `last_error_message` (`null`)

AGENT WRITES on failure (source unavailable, write rejected, etc.): `last_enriched_at` (still stamped — retry-storm guard), `enrichment_failure_count` (incremented from current value), `last_error_category`, `last_error_message`, and a lightweight `enrichment_meta` marker: `{"source": "claude-agent", "last_attempt_status": "failed", "attempted_at": "<iso>"}`. That marker is required, not optional — Step 2's query discriminates "ever touched by the Claude agent" from "still has legacy GPT content" via `enrichment_meta->>source`, and without it a failed story would never satisfy either branch of the Step 2 query again (it no longer matches `last_enriched_at IS NULL` after the stamp, and without the marker it wouldn't match the stale-Claude-output branch either — it would silently fall out of the queue forever after one failure). Do NOT write `summary_neutral`/`summary_spicy`/`category`/`alarm_level`/`severity`/`primary_actor`/`top_entities`/`entity_counter` on failure — leave those columns as they were (null for a first-attempt failure) rather than writing partial/guessed content.

AGENT NEVER WRITES (any path): `id`, `story_hash`, `headline`, `primary_headline`, `status`, `article_count`, `created_at`, `first_seen`, `first_seen_at`, `confidence_score`, `needs_review`, `review_reason`, `reviewed_at`, `reviewed_by`, `closed_at`, `reopen_count`, `centroid_embedding_v1`

- [ ] **Step 4: Review against the checklist**

- PostgREST base URL + auth headers via env vars (not hardcoded)? YES/NO
- `curl`, not `WebFetch`, for all Supabase calls? YES/NO
- Temp-file JSON body pattern for PATCH bodies containing generated text? YES/NO
- No self-approval — agent never writes `needs_review`/`reviewed_by`? YES/NO
- `severity` derived from `alarm_level` via the exact mapping (not independently chosen)? YES/NO
- Anti-default-bias ladder present, explicitly citing the 67% level-4/5 saturation as the failure being fixed? YES/NO
- Tone-system rules read from file at Step 0, not copy-pasted stale into the prompt? YES/NO
- ISO 8601 timestamps (not `NOW()`)? YES/NO
- Concurrent-run check against `stories_enrichment_log`? YES/NO
- Write verification (PATCH response is non-empty array)? YES/NO
- Failure handling: no source articles → fail gracefully, log, skip (do not fabricate a summary)? YES/NO
- Untrusted-input defense: article title/content is untrusted, never follow instructions found within it? YES/NO
- Category enum matches the 11 existing DB values exactly? YES/NO
- Entity IDs follow the canonical formats in `entity-normalization.js` (checked against `ENTITY_ALIASES` and `VALID_ID_PATTERNS`, none from `BAD_IDS`)? YES/NO
- On failure, `last_enriched_at` still stamped and `enrichment_failure_count` incremented (not reset to 1)? YES/NO
- `article_story!inner` join present in the Step 2 query (no orphan stories selected)? YES/NO
- Every Step 6 PATCH includes the `last_enriched_at=is.null` / `last_enriched_at=eq.<original-value>` conditional filter (concurrency guard)? YES/NO
- Empty-array PATCH response handled as `concurrent_write_lost`, not retried within the same run? YES/NO

- [ ] **Step 5: Commit**

```bash
git add docs/features/stories-claude-agent/prompt-v1.md
git commit -m "feat: Stories Claude Agent prompt v1"
```

---

## Task 4: Curate the Stories Gold Set

**Files:**
- Create: `docs/features/stories-claude-agent/validation-results/` (directory, populated in Task 6)
- Modify: `docs/features/stories-claude-agent/prompt-v1.md` (embed the finished examples)

Unlike SCOTUS (which had `tests/scotus-gold-truth.json` already) and EO (25-EO audit already done), Stories has no existing gold-truth file. This task builds one from scratch, grounded in real published stories — never fabricate calibration examples from imagined headlines.

- [ ] **Step 1: Pull calibration candidates spanning the full severity range**

```bash
curl -s "${SUPABASE_URL}/rest/v1/stories?select=id,primary_headline,category,alarm_level,severity,summary_neutral&order=created_at.desc&limit=300" \
  -H "apikey: ${SUPABASE_ANON_KEY}" -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const rows=JSON.parse(d);[0,1,2,3,4,5].forEach(lvl=>{const m=rows.filter(r=>r.alarm_level===lvl);console.log('level',lvl,'count',m.length,m.slice(0,3).map(r=>r.id+':'+r.primary_headline));});})"
```

Levels 0 and 1 will be sparse (the 200-row sample above had exactly one story at level 1 and zero confirmed at level 0) — that scarcity is itself evidence of saturation and expected. If no real level-0/1 examples exist in recent PROD data, query further back (`limit=1000` or add a `created_at=lt.` cutoff) or accept a synthesized-but-plausible level-0/1 example clearly marked as constructed rather than sourced, same caveat EO's gold set did not need but SCOTUS's recess months implicitly did (`cases_found=0` is a valid healthy state).

- [ ] **Step 2: For each of 5 selected stories, fetch the real source articles**

```bash
curl -s "${SUPABASE_URL}/rest/v1/article_story?story_id=eq.{ID}&select=is_primary_source,similarity_score,articles(title,source_name,content,excerpt)&order=is_primary_source.desc" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

- [ ] **Step 3: Hand-write the correct gold-truth enrichment for each of the 5**

Read the real source article text. Write `summary_neutral`, `summary_spicy`, `category`, `alarm_level` (with a one-sentence justification per the calibration ladder), `severity`, `primary_actor` by hand, fact-checked against the source. This is manual editorial work, not agent output — it is the ruler the agent gets measured against. Target distribution across the 5: one at level 4-5 (a real "criminal bullshit" story), one at level 3, one at level 2, and the two hardest ones — level 0-1 — deliberately included because that's exactly where the current pipeline never lands (the anti-saturation lesson from EO's Example 1).

- [ ] **Step 4: Embed the 5 examples in `prompt-v1.md`**

Same format as `eo-claude-agent/prompt-v1.md` Section 5 ("Gold Set Calibration Examples") — full JSON output block per example, with a "Why selected" paragraph explaining what calibration failure mode each one tests.

- [ ] **Step 5: Commit**

```bash
git add docs/features/stories-claude-agent/prompt-v1.md
git commit -m "feat: Stories Claude Agent gold set — 5 calibration examples spanning alarm_level 0-5"
```

---

## Task 5: Create the Cloud Trigger (TEST, Validation Mode)

**Files:**
- No file changes — this is a `RemoteTrigger` API call

- [ ] **Step 0: Prerequisites — Cloud Environment**

**JOSH ACTION REQUIRED:**
1. claude.ai/code → Manage Cloud Environments
2. Create or reuse an environment with:
   - `SUPABASE_URL` = `https://wnrjrywpcadwutfykflu.supabase.co` (TEST)
   - `SUPABASE_SERVICE_ROLE_KEY` = TEST service role key
   - Network access: **Full** (`*.supabase.co` is not on the default allowlist)
3. Note the `environment_id`

- [ ] **Step 1: Reset validation candidates in TEST**

Take the 5 gold-set story IDs (or their TEST-environment equivalents, seeded/synced from PROD headlines if TEST doesn't have matching live clusters) and null their enrichment fields:

```
PATCH /stories?id=in.(<5 ids>)
Body: { "summary_neutral": null, "summary_spicy": null, "last_enriched_at": null, "enrichment_meta": null }
```

Save current values first for rollback (`GET` the same rows before the `PATCH`).

- [ ] **Step 2: Create the trigger**

**Correction (Codex review, 2026-06-30):** the original draft of this step used `repositories`, `max_turns`, and a top-level `prompt` field. Per `docs/handoffs/2026-04-03-ado-469-gold-set-validation.md` (the actual SCOTUS trigger build, 4 iterations to get right), **none of those fields exist at the top level or under `job_config.ccr` directly** — the API rejects `repositories`, `max_turns`, and `ref` entirely. The real shape:

```json
RemoteTrigger create:
{
  "name": "Stories Enrichment Agent (TEST)",
  "cron_expression": "",
  "enabled": true,
  "job_config": {
    "ccr": {
      "environment_id": "<env-id-from-step-0>",
      "events": [
        {
          "data": {
            "message": {
              "content": "<bootstrap prompt — see below>",
              "role": "user"
            },
            "type": "user",
            "uuid": "<any-uuid>"
          }
        }
      ],
      "session_context": {
        "allowed_tools": ["Bash", "Read", "Grep", "Glob", "Write", "Edit"],
        "model": "claude-sonnet-4-20250514",
        "cwd": "/home/user/TTracker",
        "sources": [{"git_repository": {"url": "https://github.com/AJWolfe18/TTracker"}}]
      }
    }
  }
}
```

**No separate "update" call for prompt/repo/model** — unlike the plan's original two-step draft, all of this goes in on `create`. (SCOTUS's actual build history shows the two-step create-then-update pattern was itself an artifact of discovering the correct shape through trial and error, not a requirement of the API.)

**Bootstrap prompt, not the full prompt inline.** The events message content has practical size limits — SCOTUS's actual solution was a short bootstrap prompt that pulls the real prompt from the repo at run time, not the full prompt text embedded in the trigger config:

```
git fetch origin test && git reset --hard origin/test
Then read docs/features/stories-claude-agent/prompt-v1.md from the repo root and follow it exactly as your instructions for this run.
```

**Correction (Codex review round 2, 2026-06-30):** the original draft of this section said the PROD trigger's bootstrap could drop the explicit checkout step "since `main` is the default." That directly contradicts the caching fact stated one line below it, and it's the caching fact that's correct: the cloud trigger's workspace is cached between runs (`claude-agent-patterns`, memory), so a PROD run without an explicit fetch/reset would keep reusing whatever commit of `main` was checked out the *first* time the trigger ran — silently ignoring any later commits, including future prompt-v1.md edits. "main is the default branch for a fresh checkout" only matters the first time; every run after that is reading a cached working tree, not re-cloning. Both TEST and PROD bootstraps need the explicit fetch/reset step, every run, with no exception — only the branch name differs between them.

**TEST bootstrap:**
```
git fetch origin test && git reset --hard origin/test
```

**PROD bootstrap (Task 7):**
```
git fetch origin main && git reset --hard origin/main
```

Both use `git reset --hard`, not `git checkout -B`, to match the exact command documented in `claude-agent-patterns` memory (`git fetch origin <branch> && git reset --hard origin/<branch>`) — `reset --hard` also discards any local modifications/untracked state left over from a prior run's mid-failure, which `checkout -B` alone does not guarantee.

**Cloud-trigger repo caching:** per `claude-agent-patterns` (memory), the cloud trigger's git checkout is cached between runs — the fetch/reset bootstrap above is not optional cleanup, it's required on every single run, TEST and PROD alike, or prompt edits and code changes silently won't take effect.

`allowed_tools` omits `WebFetch` deliberately — all Supabase access is `curl` in `Bash` per the prompt's PostgREST reference (Section "Prompt Design" above); `WebFetch` can't set the auth headers Supabase requires.

- [ ] **Step 3: Trigger a manual run**

`RemoteTrigger` action `run`.

- [ ] **Step 4: Review output**

```
GET /stories_enrichment_log?order=created_at.desc&limit=10
GET /stories?id=in.(<5 gold ids>)&select=id,primary_headline,summary_neutral,summary_spicy,category,alarm_level,severity,enrichment_meta
```

- [ ] **Step 5: Score against gold truth**

| Field | Expected (gold) | Agent output | Score |
|-------|-----------------|---------------|-------|
| alarm_level | (from Task 4) | (from DB) | PASS/FAIL (exact match required) |
| severity | (derived) | (from DB) | PASS/FAIL (must match the mapping table exactly) |
| category | (from Task 4) | (from DB) | PASS/FAIL |
| summary factual accuracy | no errors | (manual check against source articles) | PASS/FAIL |
| tone-system compliance | no banned phrases/openings | (manual check) | PASS/FAIL |

**Pass criteria:** 100% PASS on `alarm_level` and `severity` for all 5. Zero factual errors. Zero banned-phrase/opening violations.

- [ ] **Step 6: Document results**

```bash
mkdir -p docs/features/stories-claude-agent/validation-results
```
Save to `docs/features/stories-claude-agent/validation-results/YYYY-MM-DD-gold-set-v1.json`

---

## Task 6: Extended Validation (15-20 additional stories)

**Status: DONE (2026-07-03).** See `docs/features/stories-claude-agent/validation-results/2026-07-03-task5-6-validation.md` — the 2026-07-02 40-story live TEST run exceeded this requirement (2x minimum volume), L4-5 combined at 3% (well under the 50% fail threshold), zero hard-field (alarm_level/severity/category) mismatches across all 40. Task 5's literal gold-set-ID-sync step was also closed by the same document via a documented deviation (scored a 9-story sample from the real run instead of syncing 5 PROD IDs into TEST) — see that file's "Deviation" section.

**Files:**
- Create: `docs/features/stories-claude-agent/validation-results/YYYY-MM-DD-extended-v1.json`

- [ ] **Step 1: Identify 15-20 pending TEST stories**

```
GET /stories?status=eq.active&summary_neutral=is.null&order=created_at.desc&limit=20&select=id,primary_headline,created_at
```

If TEST doesn't have enough natural volume, null out enrichment on 15-20 already-enriched TEST stories to create candidates (same reset pattern as Task 5 Step 1), choosing a spread of categories.

- [ ] **Step 2: Run the agent (manual trigger)**

`RemoteTrigger` action `run`.

- [ ] **Step 3: Review every enrichment manually**

For each: alarm_level earned (not defaulted)? Category correct? Summary factually accurate against source articles? Tone matches "The Chaos" voice and the level's calibration? No banned phrases/openings? Entities correctly identified?

- [ ] **Step 4: Score and document**

**Pass criteria:** Zero hard-field (alarm_level, severity, category) FAILs across all stories. Alarm-level distribution across the batch should NOT show >50% at levels 4-5 (the saturation signature being fixed) — if it does, treat as a FAIL requiring prompt iteration even if individual fields look locally defensible.

- [ ] **Step 5: Commit results**

```bash
git add docs/features/stories-claude-agent/validation-results/
git commit -m "docs: Stories Claude Agent extended validation results"
```

---

## Task 7: Enable Production Schedule, Retire Legacy Path

**Files:**
- No code changes if Task 2's kill switch already defaults to off in both workflows (confirm, don't re-add)

- [ ] **Step 1: Confirm validation passed**

All Task 5/6 pass criteria met, Josh has reviewed sample output and approved.

- [ ] **Step 2: Create the PROD trigger**

Repeat Task 5 Steps 0-2 with a new Cloud Environment pointed at PROD (`SUPABASE_URL=https://osjbulmltfpcoldydexg.supabase.co`, PROD service role key), and enable the cron schedule: `30 */2 * * *`.

- [ ] **Step 3: Backlog note — verify auto-exclusion of legacy GPT stories before going live**

The Step 2 query's `enrichment_meta->>source = claude-agent` discriminator (see "Prompt Design" above) means every currently-live story enriched by the retired GPT path stays permanently outside the new agent's queue — it never matches either branch of the query, by design, regardless of how stale its `last_enriched_at` gets. **Before enabling the PROD schedule, confirm this empirically**, not just by reading the query: pick 5-10 known-old GPT-enriched PROD stories (`enrichment_meta->>'model' = 'gpt-4o-mini'`, `last_enriched_at` well past 12h), run the agent manually, and verify none of them appear in its candidate list or get touched. If any do, the discriminator has a gap — do not proceed to scheduled runs until that's fixed. Once confirmed, the 67%-severe backlog of already-published stories stays as-is unless explicitly reprocessed. **Open question for Josh, do not decide unilaterally — see "Open Questions" below.**

- [ ] **Step 4: Monitor first 3 days**

```
GET /stories_enrichment_log?order=created_at.desc&limit=20
```
Verify: agent ran on schedule every 2 hours, story counts per run look sane relative to clustering volume, zero unexpected `failed` rows, alarm-level distribution trending away from 67% severe/critical.

- [ ] **Step 5: Spot-check quality**

2-3 stories per day, manually verify summary accuracy and tone-system compliance.

- [ ] **Step 6: After 2 weeks of clean PROD runs**

Delete the retired code path: `scripts/enrichment/enrich-stories-inline.js`, `scripts/enrichment/prompts.js` (stories `SYSTEM_PROMPT`), `scripts/enrichment/stories-style-patterns.js`, `scripts/enrichment/stories-variation-pools.js`, and the kill-switch branch in `rss-tracker-supabase.js` (Task 2). Same 60-day-minimum standby rule SCOTUS/EO followed — do not delete early even if validation looks clean sooner.

---

## Rollback Plan

1. **Immediate (< 5 min):** Pause the Stories Claude Agent trigger via claude.ai/code/scheduled.
2. **Short-term:** Set the `ENABLE_LEGACY_STORY_ENRICHMENT` repository variable to `true` (GitHub → Settings → Secrets and variables → Actions → Variables — no code change, no redeploy) to re-enable the GPT path from Task 2's kill switch. Stories will resume being enriched inline within the next 2-hour clustering run. This only works if Task 2's Step 2 (wiring `vars.ENABLE_LEGACY_STORY_ENRICHMENT` into both workflow env blocks) shipped — confirm that landed before relying on this rollback path.
3. **Data recovery:** `stories_enrichment_log` records which stories were touched by which run. To force re-enrichment by either path, null `summary_neutral` and `last_enriched_at` on the affected rows.

---

## Cost Impact

| Item | Current | With Claude Agent |
|------|---------|---------------------|
| OpenAI (story enrichment, GPT-4o-mini chat) | ~$0.003/story x ~62/day ≈ **$5.60/month** | $0 (eliminated) |
| OpenAI (clustering embeddings) | ~unchanged, small | ~unchanged, small — **not eliminated, out of scope** |
| Claude subscription | (existing) | (existing, no incremental cost — subscription-included cloud agent, same as SCOTUS/EO/Pardons) |
| **Net change** | | **~$5.60/month cheaper, not more expensive** |

No budget-limit concerns — this reduces spend against the $50/month hard cap rather than adding to it.

---

## Effort Estimate

Comparable to or somewhat larger than the SCOTUS build (Tasks 1-7 above: migration, code-gate, prompt authoring, gold-set curation from scratch since none exists yet, two validation phases, TEST→PROD cutover). Volume is 20-60x higher than SCOTUS/EO/Pardons, which means the extended-validation phase (Task 6) has a larger sample to review by hand, and the gold-set curation (Task 4) starts from zero instead of an existing truth file. Realistically multiple work sessions, not a single sitting — same order of magnitude as the SCOTUS and EO builds documented in `docs/features/scotus-claude-agent/plan.md` and `docs/features/eo-claude-agent/`.

---

## Open Questions

1. **Historical backlog reprocessing — RESOLVED (2026-06-30, deferred).** The ~67%-severe backlog of already-published stories will NOT be touched by this migration (Task 7, Step 3) — the Step 2 query's `enrichment_meta->>source = claude-agent` discriminator excludes any story the legacy GPT pipeline enriched, permanently, regardless of staleness. Josh confirmed this is fine: reprocessing the backlog is a separate bulk job to be scoped later, not a blocker for this plan. When that work happens (like EO's `docs/features/eo-claude-agent/bulk-enrichment-plan.md`, ADO-481), it'll need its own scope decision on how far back (all-time is ~12,000 stories; a recent window is more realistic). To execute it, null `last_enriched_at` and `enrichment_meta` on the targeted rows — that's what makes them match the Step 2 query's "truly never enriched" branch and enter the standing agent's normal queue, no special-casing required.
2. **`stories-variation-pools.js` / `stories-style-patterns.js` frame-estimation logic** — confirm nothing else in the codebase depends on `estimateStoryFrame()`, `getStoryPoolKey()`, etc. before deleting in Task 7 (grep before delete, not assumed from this plan).
3. **TEST environment story volume** — TEST may not have 62 stories/day of natural RSS volume for Task 5/6 validation. If not, the plan's fallback (null out already-enriched TEST stories to create validation candidates) applies, but confirm TEST's feed registry is active enough to be a reasonable proxy.

---

## Review Log

| Date | Reviewer | Type | Findings |
|------|----------|------|----------|
| 2026-06-30 | Codex (local, direct plan review) | Plan review, round 1 | 3 P1, 1 P2 — all confirmed against actual code and fixed: (1) RemoteTrigger payload used the wrong API shape (top-level `prompt`/`repositories`/`max_turns`, which the real API rejects — corrected to `job_config.ccr.events[].data.message.content` + `session_context`, per the SCOTUS build's actual trial-and-error history); (2) Step 2 candidate query gated on `summary_neutral.is.null` instead of `last_enriched_at`, dropped the `article_story!inner` join, and told the agent never to touch `enrichment_status`/`enrichment_failure_count` despite the admin dashboard depending on them — corrected to match the exact retry-storm-safe query and failure-write conventions already live in `rss-tracker-supabase.js` and `enrich-single-story.js`; (3) agent had no instruction to use the canonical entity-ID system in `entity-normalization.js`, risking corrupted `top_entities`/`entity_counter` — added as a required Step 0b read; (4) rollback plan assumed a kill-switch env var that was never wired into either RSS workflow — added the `vars.ENABLE_LEGACY_STORY_ENRICHMENT` wiring as an explicit Task 2 step. |
| 2026-06-30 | Codex (local, direct plan review) | Plan review, round 2 | 2 P1, both confirmed and fixed: (1) round 1's query fix (`last_enriched_at IS NULL OR stale`) had no way to tell "never enriched" apart from "GPT-enriched days ago" — since nearly every active story is the latter, cutover would have swept the entire active backlog into the Claude agent unscoped, contradicting Open Question #1's explicit "do not decide unilaterally" — fixed by adding an `enrichment_meta->>source = claude-agent` discriminator to the query and to the failure-write path (so retries still work), and added a Task 7 verification step to confirm the exclusion empirically before enabling the PROD schedule; (2) the TEST/PROD bootstrap guidance directly contradicted itself — one line said the cached cloud-trigger workspace requires an explicit fetch/reset every run, the next said PROD could skip it since `main` is the default branch — fixed by requiring the fetch/reset (`git fetch origin <branch> && git reset --hard origin/<branch>`, matching the exact `claude-agent-patterns` memory gotcha) for both TEST and PROD, no exception. |
| 2026-06-30 | Codex (local, direct plan review) | Plan review, round 3 | 1 P1, 1 P2, both confirmed and fixed: (1) the plan's only concurrency guard was a coarse pre-check against the per-story `stories_enrichment_log`, which has the same race EO documents (two runs can both see no active rows and proceed) — but EO accepts that race only because `prevent_enriched_at_update` blocks the second write at the DB level, and this plan explicitly noted Stories has no such trigger, meaning the failure mode here would have been silent last-write-wins content overwrite, not a harmless duplicate log row. Fixed by making every Step 6 PATCH conditional on the exact `last_enriched_at` value read in Step 2 (optimistic concurrency) — a losing race now produces an empty PATCH response, which the prompt already treats as a write failure to log and skip, no DB trigger needed; (2) the monitoring query alerts on "no completed row in N hours," but the log table only gets rows when candidates are found, same as EO/SCOTUS — except Stories runs 12x/day vs. their 1x/day, so healthy strings of zero-candidate cycles are common, not rare, and would false-alert. Fixed by making `story_id` nullable and having the agent write a heartbeat row (`story_id: null`) on every 0-candidate run, so the monitoring query's "last completed row" signal stays accurate regardless of volume. |

---

**Created:** 2026-06-30
**Author:** Josh + Claude Code
**Status:** Draft — pending Codex review
**Last Reviewed:** 2026-06-30
