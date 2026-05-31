# Memory + Docs Redesign — Review Artifact (DRAFT, nothing executed)

**Date:** 2026-05-30
**Status:** APPROVED — QA fixes folded in (v2). Executing per §10.
**Cost:** $0 (free memory server, in-repo markdown). Zero ongoing maintenance.

This is the single artifact to approve on paper. Once you sign off, I execute in one clean pass.

> **v2 QA revisions (2026-05-30):** Added backup-first + verify-after safety (the #1 gap — this session already lost data once); corrected execution order (DEEP server must be connected via restart BEFORE writing to it); added the missing `/start-work` + CLAUDE.md 3-tier read changes (without them, sessions still bulk-load and save nothing); added the conditional architecture-doc-update step to `/end-work`; reconciled token math; exempted gotcha-collections from the obs cap; documented why live-system pointers stay HOT.

---

## 0. Why we're doing this (recap, evidence-based)

- Project memory = **65.5K chars / 23 entities**, loaded **every session** → ~16K stale tokens/session.
- Root cause: memory is used as an **append-only journal**, duplicating ADO (status), handoffs (narrative), and code (patterns) — the exact 3 things our own rules say not to store.
- Authorities back the fix: tiered memory (MemGPT/Letta), "smallest set of high-signal tokens" + context rot (Anthropic), progressive disclosure / pointers (Anthropic), docs-as-code (in-repo), ADRs (Nygard/arc42 §9).
- Target outcome (token math, reconciled): the **always-loaded** context = Global (~3–4K) + Project HOT (~7–9K) = **~11–13K chars, down from ~65K+** (Global was already small; the 65K was project-HOT alone). DEEP is never bulk-loaded. Net: no contradictory info; fast bootstrap; durable "why" gets a real home.

---

## 1. The target architecture (one job per layer)

| Layer | Source of truth for | Loaded when |
|---|---|---|
| ADO | ticket **status**, blockers | on demand (`/ado`) |
| `docs/handoffs/` | session **narrative** (what happened) | on demand |
| `docs/explanation/` + `ARCHITECTURE.md` + `docs/decisions/` (ADRs) | **how it works** + **why** | on demand |
| `docs/how-to/` + `docs/reference/` | repeatable procedures + lookups | on demand |
| **Memory — Global** | identity, prefs, cross-project gotchas | **always** (small) |
| **Memory — Project HOT** | active work, conventions, pointers, reusable gotchas | **always** (small) |
| **Memory — Project DEEP** | historical/closed-feature lessons | **search only** (never bulk-loaded) |
| Code | ground truth (what it does) | on demand |

Memory becomes a thin **router + gotchas** layer that points at everything else.

---

## 2. Memory: 3-tier setup

Add a third memory file on the **same** free server (one `.mcp.json` entry, no new code):

```
Global   → C:\Users\Josh\.claude-memory\global\memory.jsonl        (exists, always read)
HOT      → C:\Users\Josh\.claude-memory\ttracker\memory.jsonl       (exists, always read — gets curated)
DEEP     → C:\Users\Josh\.claude-memory\ttracker-archive\memory.jsonl  (NEW — search-only)
```

- `/start-work`: read Global + HOT always. Search DEEP only when a task touches old work.
- Closed-ticket lessons get **moved to DEEP**, not deleted — nothing valuable is lost, it just stops loading every session.
- Per-session memory cost stays flat (~3–5K tokens) no matter how much history accumulates.

---

## 3. Proposed FINAL HOT graph (verbatim — this is exactly what gets written)

> Convention: `entityType` = the category (controlled vocab: `profile`, `convention`, `gotcha`, `pointer`, `feature`). Volatile lines start with `[YYYY-MM-DD]`. Durable lines undated. Observation [0] of pointer/feature entities is a `META |` line.

### HOT entity: `active-work`  *(pointer)* — the "hot list", the first thing read
```
[0] META | tier:hot | updated:2026-05-30 | this is the "where we left off" anchor; status lives in ADO, not here
[1] [2026-05-30] Active: Pardons Claude Agent (ADO-516 epic) — next = S1/ADO-518 migration 094_pardons_enrichment_log; PR #94 (auto-publish fix) must merge before S5 PROD deploy
[2] [2026-05-30] Open blocker: social-share — Josh must set Netlify PROD env vars (SUPABASE_URL + ANON_KEY) to PROD values + redeploy; currently TEST values (ADO #515)
[3] [2026-05-30] Backlog item worth a ticket: PROD Supabase storage 570MB over 500MB limit; 47 unused indexes flagged (verify RPC usage before dropping HNSW)
[4] [2026-05-30] Parked: events-tracker feature — schema v1 rejected, design locked, see docs/features/events-tracker/design.md
```

### HOT entity: `repo-map`  *(pointer)* — bootstrap router for any fresh session
```
[0] META | tier:hot | updated:2026-05-30 | points to canonical docs; do not duplicate their content here
[1] Product vision/voice → docs/PRODUCT_VISION.md
[2] High-level architecture → docs/ARCHITECTURE.md  (+ docs/explanation/ for detail)
[3] DB schema → docs/reference/database-schema.md
[4] Tone system (single source of truth) → public/shared/tone-system.json
[5] Rules/workflow/branching → CLAUDE.md
[6] How-to procedures (RSS trigger, Supabase update, PROD deploy) → docs/how-to/
[7] Decisions + why → docs/decisions/ (ADRs)
```

### HOT entity: `memory-policy`  *(pointer)*
```
[0] META | tier:hot | updated:2026-05-30
[1] The rules for what goes in memory live in ONE place → docs/memory-policy.md
[2] Short version: store durable facts + decisions + gotchas + pointers; never status/metrics/narrative; curate every /end-work
```

### HOT entity: `conventions`  *(convention)* — durable project rules (folds in old TTracker-Rules)
```
[0] META | tier:hot | updated:2026-05-30
[1] BACKFILL/ENRICHMENT defaults to PROD, never TEST, unless told otherwise — when Josh says "enrich"/"backfill" he means PROD ~99% of the time
[2] Work on `test` branch; PROD via cherry-pick + PR only; never push origin main
[3] New Claude-agent domains mirror the SCOTUS/EO skeleton (env setup, PostgREST-via-curl, gold set, voice, failure handling, invariants)
```

### HOT entity: `claude-agent-patterns`  *(gotcha)* — the GOLD, extracted from the two 47/56-obs epic logs
```
[0] META | tier:hot | updated:2026-05-30 | reusable across SCOTUS/EO/Pardons agents
[1] WebFetch CANNOT set custom headers/methods/body — use Bash/curl for all PostgREST calls in cloud-agent prompts
[2] Cloud trigger git repo is CACHED between runs — bootstrap MUST run `git fetch origin <branch> && git reset --hard origin/<branch>` or prompt changes are ignored
[3] PostgREST limit=0 means NO LIMIT (returns ALL rows), not zero — never use for empty-result queries
[4] PostgREST returns HTTP 416 when offset exceeds total count (Content-Range still valid) — treat as empty page
[5] prevent_enriched_at_update trigger blocks PATCH when new prompt_version <= old (lexicographic) — null the fields first to re-enrich
[6] Federal Register html_url is Cloudflare-blocked for automation; use body_html_url or the FR /api/v1/ endpoint
[7] `npx supabase functions deploy` works without Docker (warning only) and uses cached CLI creds — no SUPABASE_ACCESS_TOKEN needed if Josh logged in once
[8] Admin-tab bugs to never repeat: sort parser must use lastIndexOf('-') not split('-') (underscored keys); cursor validator must reject ISO timestamps for DATE columns; sort+stringify arrays before change-detection
[9] Netlify: env-var line breaks silently break API auth (401); Vite needs @netlify/vite-plugin for edge functions to be detected
```

### HOT entity: `pardons-agent`  *(feature)* — thin pointer (was 12-obs log)
```
[0] META | tier:hot | updated:2026-05-30 | ado:516 | docs:docs/features/pardons-claude-agent/{prd,plan}.md
[1] Replaces Perplexity+GPT pardons pipeline; mirrors SCOTUS (ADO-467) + EO (ADO-476) Claude-agent pattern
[2] Why Claude not GPT: audit found 116/118 empty crime_description + systematic under-leveling (FACE Act, Tina Peters); problem is research quality, not the scale
[3] [2026-05-28] Gotcha for S4: admin-update-pardon rejects corruption_level 0 (should allow 0-5); VALID_CONNECTION_TYPES missing wealthy_unknown/cabinet_connection/lobbyist
[4] Gotcha: receipts_timeline & source_urls are NOT NULL — agent must send [] not null
```

### HOT entity: `scotus-agent`  *(feature)* — thin pointer (was 47-obs log; detail → handoffs/ADRs, gotchas → above)
```
[0] META | tier:warm | updated:2026-05-27 | ado:467 (closed) | docs:docs/features/scotus-claude-agent/
[1] LIVE on PROD: daily cron (0 16 * * 1-5), Opus model, 116/116 cases enriched 0 failures. Replaced 4,300-line GPT pipeline (60% contradiction rate)
[2] Design: single-pass fact+editorial (splitting them was the root cause of contradictions); agent never self-approves/auto-publishes... except is_public=true set on enrich since 2026-05-27 auto-publish fix
[3] Decision rationale lives in ADR → docs/decisions/ (see §6)
```

### HOT entity: `eo-agent`  *(feature)* — thin pointer (was 56-obs log)
```
[0] META | tier:warm | updated:2026-05-27 | ado:476 | docs:docs/features/eo-claude-agent/
[1] LIVE on PROD: daily cron, all 250 EOs enriched at v1.1, backlog drained. Replaced GPT-4o-mini pipeline (88% level-4 saturation, fabricated cronyism)
[2] Decision: full agent migration not prompt iteration — rationale in ADR (see §6)
[3] prompt_version='v1' string collides between old-GPT and new-Claude output — treat with care; CLAUDE_AGENT_VERSIONS allow-list = ['v1.1']
```

### HOT entity: `tone-system`  *(pointer)* — trimmed from 13 obs to a pointer
```
[0] META | tier:hot | updated:2026-05-30
[1] Single source of truth → public/shared/tone-system.json (voices, 0-5 calibration, labels, profanity 4-5 only, 27 banned openings)
[2] Layered docs → docs/PRODUCT_VISION.md (DOs/DONTs) + docs/features/labels-tones-alignment/plan.md (architecture)
[3] Voices: SCOTUS='The Betrayal', Stories='The Chaos', EOs='The Power Grab', Pardons='The Transaction'
```

**HOT total: ~10 entities, est. ~7–9K chars** (down from 65K / 23). Combined with Global (~3–4K), always-loaded ≈ **~11–13K** (was ~65K+).

> **Cap exception:** `claude-agent-patterns` intentionally holds 9 observations, exceeding the ~6 cap. Gotcha-collection entities (entityType `gotcha`) are **exempt from the per-entity observation cap** — they're a curated reference list, not a session log. This exemption is written into `memory-policy.md` (§5).

---

## 4. What moves to DEEP (search-only) and what's deleted

**Move to DEEP** (closed/shipped, kept for occasional keyword search):
`ADO-340-scotus-admin-tab`, `ADO-466-silent-skip-visibility`, `ADO-473-scotus-legacy-cleanup`, `ADO-475-normalizepublishedat-bug`, `ADO-477-eo-enrichment-log`, `ADO-478-eo-prompt-goldset`, `ADO-480-eo-admin-tab`, `ADO-473-482-legacy-retirement`, `ui-build-phase3`, `ui-phases-4-6-qa`, `prod-ui-deployment-2026-05-21`, `PROD Pipeline Health`, `prod-deployment-gotchas`.

> Before moving: their few durable gotchas are already extracted into `claude-agent-patterns` (§3). DEEP keeps the full record in case you ever need the play-by-play.

**Delete outright** (pure ephemera, nothing durable):
`repo-cleanup-2026-04-13` (one-off cleanup, done).

**Why `scotus-agent`/`eo-agent` stay in HOT despite closed ADO tickets:** the "closed → DEEP" rule is about closed *work*. These two are **live production systems** (daily cron agents enriching PROD) referenced almost every session — a closed ticket doesn't make a running system historical. They stay in HOT as thin `tier:warm` pointers. Rule of thumb: *is it still running / still referenced? → HOT. Is it done and rarely needed? → DEEP.*

**Genuinely-open item to track:** `ADO-482` (retire legacy EO scripts) is the one still-open EO story. It lives in ADO (status's home), and is noted on the `eo-agent` HOT entity's next-step rather than spawning a separate entity.

**Global tier — fix the wrong info:**
- `claude-code-mcp-env-caching`: delete the 6 superseded observations that the entity's own "CORRECTION" line says are wrong; keep the correct root-cause + the verify-first diagnostic.
- Move general prefs currently mislabeled in project `josh-preferences` → global `josh-communication-style`; drop project duplicates of the PAT/MCP saga (already in global).

---

## 5. `docs/memory-policy.md` (proposed full text — the rules' single home)

```markdown
# Memory Policy (single source of truth for what goes in Memory MCP)

## Three tiers
- Global (always read): identity, preferences, cross-project gotchas.
- Project HOT (always read): active work, conventions, pointers, reusable gotchas. Keep small.
- Project DEEP (search only): closed-feature lessons, historical record.

## The filter — store an observation ONLY if:
"Would the next session waste 5+ minutes without this, AND is it not already in
ADO / git / code / a doc?" If no → don't store it; point to the doc instead.

## STORE
- Durable facts, decisions + WHY, hard-won gotchas, pointers (ADO#, doc path, commit).

## NEVER STORE
- Ticket/work STATUS (→ ADO). Metrics/spend/counts (→ query Supabase). Session
  narrative (→ handoffs). Code patterns / file lists (→ code & git). Anything in CLAUDE.md.

## Conventions
- entityType is the category: profile | convention | gotcha | pointer | feature.
- Volatile observations start with [YYYY-MM-DD]; durable facts undated.
- Pointer/feature entities: observation[0] is a META line: tier | updated | ado | docs.
- `active-work` is the "where we left off" anchor — update it; never spawn a new session-blob entity.

## Per-entity observation cap
- ~6 observations per entity. EXCEPTION: entityType `gotcha` (curated reference
  lists like claude-agent-patterns) are exempt — they're not session logs.

## /end-work does BOTH every session
1. APPEND new observations that pass the filter.
2. CURATE: update/delete stale observations, cap entities at ~6 observations
   (gotcha-collections exempt), demote closed-WORK entities to DEEP (extract any
   durable gotcha to HOT first). Live production systems stay HOT even if the
   ticket is closed.

## Safety (memory has NO version history — files are gitignored)
- Before ANY destructive memory operation (delete/overwrite), back up all three
  memory.jsonl files to a timestamped folder.
- After curation, re-read HOT and confirm it matches intent before finishing.
```

---

## 6. `/end-work` — proposed replacement for Step 1 (curate AND append)

Replaces the current "Save Session State" step:

```markdown
### 1. Update Memory (append + curate — per docs/memory-policy.md)
SAFETY FIRST: memory files are gitignored (no version history). Before deleting or
overwriting any observation, back up all three memory.jsonl files to a timestamped
folder under C:\Users\Josh\.claude-memory\_backups\.

Apply the filter in docs/memory-policy.md. Then do BOTH:

APPEND (Global + Project HOT):
- New decisions made this session and WHY (highest value)
- New durable conventions or gotchas discovered
- Update the `active-work` anchor: what's live + next step (NOT status — that's ADO)

CURATE (mandatory — this is what stops bloat):
- Delete/update observations this session made stale
- Cap each entity at ~6 observations (gotcha-collections exempt); if a feature log
  is growing, trim to a pointer
- If WORK CLOSED this session: extract any reusable gotcha to HOT, then move the
  entity to Project DEEP. (Live production systems stay HOT even if ticket closed.)
- Never duplicate across Global/HOT/DEEP

Hard limits: max 3–5 new observations per session; one sentence each.
```

### NEW step in `/end-work` — keep architecture docs live (conditional)
```markdown
### Xa. Update living docs (only if system shape changed)
If this session changed schema, a pipeline, an API/contract, or system structure:
- Update docs/ARCHITECTURE.md (and the Mermaid flow if data flow changed)
- Update the affected docs/explanation/ or docs/reference/ file
- If a real architecture DECISION was made, add an ADR to docs/decisions/
Skip this step entirely for bugfixes, UI tweaks, copy changes, config edits.
```

---

## 7. Docs restructure (Diátaxis, used loosely — 3 buckets, no Tutorial)

New/!moved layout. **This is mostly relabeling existing files**, not rewriting them:

```
docs/
  README.md            ← NEW: the map/index (human entry point)
  llms.txt (repo root) ← NEW: agent-readable doc map (agents are ~half the readers)
  ARCHITECTURE.md      ← NEW: explanation + 1 Mermaid pipeline diagram
  decisions/           ← NEW: ADRs (the "why")
    0001-claude-agents-over-gpt-pipelines.md
  how-to/              ← procedures (YOUR idea — biggest practical win)
    trigger-rss-test.md         (move from guides/triggering-rss-tracker-test.md)
    supabase-update.md          (NEW — see §9 example)
    prod-cherry-pick-deploy.md  (extract from CLAUDE.md PROD section)
    common-lookups.md           (NEW — the PostgREST/SQL snippets you reuse)
  reference/           ← lookups
    database-schema.md          (move from database/database-schema.md)
    category-enums.md           (extract from CLAUDE.md)
    secrets-and-env.md          (extract from CLAUDE.md)
  explanation/         ← deep architecture
    rss-system.md, clustering-scoring.md, dashboard-architecture.md (move from architecture/)
  handoffs/            ← unchanged (session narrative)
  features/            ← unchanged (active feature PRDs/plans)
  archive/             ← unchanged
```

Diagrams: **Mermaid only, and only for the pipeline flow** (text source = agent-readable + renders in GitHub/VS Code, never rots). Everything else = labeled prose lists, which are clearer than diagrams for component responsibilities.

---

## 8. Skeletons

### `docs/ARCHITECTURE.md`
```markdown
# TrumpyTracker Architecture (high-level)

> Living doc. Update only when system SHAPE changes (new pipeline, contract, data flow).
> Detail lives in docs/explanation/; decisions in docs/decisions/.

## What it is
AI political-accountability tracker: RSS feeds → clustered Stories → AI summaries,
plus SCOTUS, Executive Orders, and Pardons trackers.

## Pipeline flow
```mermaid
flowchart LR
  A[GitHub Actions cron] --> B[rss-tracker-supabase.js]
  B --> C[Fetch active feeds]
  C --> D[Cluster into Stories]
  D --> E[AI enrich GPT-4o-mini]
  E --> F[(Supabase: stories/articles)]
  F --> G[Edge Functions]
  G --> H[Frontend React app]
  subgraph Claude Cloud Agents (daily cron)
    S[SCOTUS agent] --> F
    EO[EO agent] --> F
    P[Pardons agent planned] --> F
  end
```

## Components (what each owns)
- **RSS pipeline** (`rss-tracker-supabase.js`): fetch → cluster → enrich. Budget-capped.
- **Claude cloud agents**: SCOTUS/EO/(Pardons) enrichment; never auto-approve.
- **Supabase**: Postgres + Edge Functions + RLS. TEST vs PROD projects.
- **Frontend**: Vite/React app; PostgREST direct reads + edge functions.
- **Admin dashboard** (`admin.html`): review/publish/re-enrich.

## Environments
- `test` branch → Supabase TEST → Netlify test site
- `main` (protected) → Supabase PROD → trumpytracker.com

## See also
- Why Claude agents replaced GPT pipelines → docs/decisions/0001-*
- How data is clustered → docs/explanation/clustering-scoring.md
```

### `docs/decisions/0001-claude-agents-over-gpt-pipelines.md` (ADR, Nygard format)
```markdown
# 1. Claude cloud agents over GPT/Perplexity enrichment pipelines

Date: 2026-05-30  ·  Status: Accepted

## Context
GPT-based enrichment (SCOTUS 4,300 lines/60% contradictions; EO 88% level-4
saturation + fabricated cronyism) failed on tone and facts. ~2 months of prompt
iteration on SCOTUS did not fix it; small-model failure modes resist prompt rules.

## Decision
Replace per-domain GPT/Perplexity pipelines with single-pass Claude Code cloud
scheduled agents (SCOTUS shipped, EO shipped, Pardons planned). Single-pass
fact+editorial; human review required; agents never self-approve.

## Consequences
+ SCOTUS 116/116 enriched, 0 failures. EO 250/250. ~$20/mo OpenAI saved ($0 marginal on Anthropic sub).
+ One reusable prompt skeleton across domains.
- Cloud-trigger gotchas (cached git repo, WebFetch header limits) — see memory `claude-agent-patterns`.
- prompt_version string collisions between old/new output require allow-lists.
```

### `docs/how-to/supabase-update.md` (your example how-to)
```markdown
# How to: update data in Supabase (TEST vs PROD)

> Default target for "enrich/backfill" is PROD unless told otherwise.

## Read (cheap, egress-aware)
- MCP: `mcp__supabase-test__postgrestRequest`, always `select=id,field1` + `limit=10`.
- Never select `embedding` (6KB/row) or `content` (5KB+/row) unless required.

## Write (one row / ad hoc)
- TEST via MCP postgrestRequest (PATCH/POST).
- PROD: use the PROD project ref; confirm cost before bulk.

## Bulk / backfill
- State egress + $ impact first. Check `budgets` table (halt if spent_usd > $5/day).
- Prefer SQL via execute_sql over fetching rows to the client.

## Gotchas
- limit=0 = NO LIMIT (all rows). HTTP 416 = offset past end (empty page).
- NOT NULL array cols (receipts_timeline, source_urls): send [] not null.
- enriched_at lock trigger blocks same/lower prompt_version PATCH — null fields first.
```

### `docs/README.md` (the map) + `llms.txt` (root)
```markdown
# TrumpyTracker Docs Map
- Start here / architecture → ARCHITECTURE.md
- Why decisions were made → decisions/
- How to do X (procedures) → how-to/
- Look up facts (schema/enums/env) → reference/
- Deep architecture → explanation/
- Session history → handoffs/
- Active features → features/
```
(`llms.txt` = same list, plain, at repo root for AI tools.)

---

## 9. Existing-docs relabeling map (move, don't rewrite)

| Current | New home | Type |
|---|---|---|
| `docs/guides/triggering-rss-tracker-test.md` | `docs/how-to/trigger-rss-test.md` | how-to |
| `docs/guides/prod-deployment-checklist.md` | `docs/how-to/prod-deploy.md` | how-to |
| `docs/guides/feature-flags.md` | `docs/how-to/feature-flags.md` | how-to |
| `docs/database/database-schema.md` | `docs/reference/database-schema.md` | reference |
| `docs/architecture/rss-system.md` | `docs/explanation/rss-system.md` | explanation |
| `docs/architecture/clustering-scoring.md` | `docs/explanation/clustering-scoring.md` | explanation |
| `docs/architecture/dashboard-architecture.md` | `docs/explanation/dashboard-architecture.md` | explanation |
| (CLAUDE.md category map) | `docs/reference/category-enums.md` (CLAUDE.md points to it) | reference |
| (CLAUDE.md secrets table) | `docs/reference/secrets-and-env.md` | reference |

> Moving files means updating any links in CLAUDE.md — handled in the execution pass. CLAUDE.md trim itself = separate prompt later, per your note.

---

## 10. Execution order (corrected for safety + dependencies)

**Phase A — Safety (do first, always):**
0. **Back up** all three memory.jsonl files (global, ttracker, ttracker-archive-if-exists) to `C:\Users\Josh\.claude-memory\_backups\2026-05-30\`. Confirm byte counts. This is the rollback path memory otherwise lacks.

**Phase B — Docs (zero risk; pure additions, no memory touched):**
1. Create `docs/memory-policy.md` (§5).
2. Create `docs/README.md`, root `llms.txt`, `docs/ARCHITECTURE.md`, `docs/decisions/0001-*.md`, `docs/how-to/supabase-update.md` (§8).
3. (Deferred unless you say go now) Move existing docs per §9 + fix links. Default this round: create NEW docs only, leave existing files in place — see Open Q2.

**Phase C — Command + CLAUDE.md wiring (the part that actually saves tokens):**
4. Update `/end-work` Step 1 → curate+append+safety (§6) and add the conditional architecture-doc step (§6 new step).
5. Update `/start-work` Step 1: "read Global + HOT; search DEEP on demand" (NOT bulk read_graph).
6. Update CLAUDE.md "first 3 commands" + Memory MCP section: same 3-tier read rule + point to `docs/memory-policy.md` instead of restating rules. (This is the FUNCTIONAL 3-tier edit — distinct from the separate CLAUDE.md style-trim prompt Josh is handling later.)

**Phase D — DEEP server (must connect BEFORE writing to it):**
7. Add `memory-deep` (or reuse `ttracker-archive` path) to `.mcp.json`.
8. **Claude Code restart required** — MCP servers load at startup. Cannot write to DEEP until reconnected.

**Phase E — Memory migration (after backup + after DEEP is live):**
9. Fix Global (§4): trim wrong observations from `claude-code-mcp-env-caching`; relocate mislabeled prefs.
10. Build HOT: create the ~10 new entities (§3). Extract gotchas into `claude-agent-patterns` FIRST.
11. Move closed-work entities (§4) into DEEP; delete `repo-cleanup-2026-04-13`; delete the old superseded project entities once their content is confirmed in HOT/DEEP.

**Phase F — Verify (the after-check this session lacked):**
12. Re-read HOT + Global; diff against §3/§4 intent. Confirm: no orphaned data, no duplicates across tiers, counts match.
13. Commit docs/command changes on `test`. (Memory files are gitignored — they're backed up, not committed.)

> **Restart note:** Phases A–C and E need NO restart for the *current* tools. Only Phase D's DEEP server requires the restart, which is why memory migration (E) is sequenced after it. If you'd rather avoid a mid-task restart, alternative: skip DEEP for now (Open Q1) and just delete closed entities after backup — then no restart is needed this session.

---

## Open questions for Josh
1. **DEEP tier** — add it now (recommended), or skip and just delete closed entities?
2. **Doc moves** — do the full relabel (§9) now, or only create the NEW docs (README/ARCHITECTURE/decisions/how-to) and leave existing files where they are for now?
3. **Anything in §4 "delete/move" you want kept in HOT instead?**
```
