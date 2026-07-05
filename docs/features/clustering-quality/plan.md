# Clustering Quality — Diagnostic (Part 1) + v2 Architecture Plan (Part 2)

> **Part 1** (below) is the closed ADO-529 diagnostic — keep as the evidence record, don't re-run its analysis.
> **Part 2** (bottom of this doc) is the plan of record for the next phase, from the 2026-07-05 architecture session with Josh. A new session picks up from Part 2.

# Part 1: Clustering Quality Audit — Findings & Recommendation (ADO-529)

**Goal:** Diagnose why PROD story clustering only merges ~1.4 articles/story (12,088 stories vs 17,210 articles lifetime), determine root cause, and recommend (not redesign) a fix.

## Global Constraints

- Budget: <$50/month hard limit (`CLAUDE.md`). This fix has **zero cost impact** — clustering already computes embeddings/entities for every article; the change only affects which existing candidate gets selected, no new AI calls.
- Work on `test` branch; PROD via cherry-pick + PR only; never push `origin main` directly.
- No Python — Node.js/JavaScript only.

---

## Diagnostic Summary (AC1)

Reviewed the clustering pipeline (`scripts/rss/hybrid-clustering.js`, `scripts/rss/scoring.js`, `scripts/rss/candidate-generation.js`) — this is not a naive/first-pass system. It already carries ~20 tickets of prior tuning (TTRC-230 through TTRC-357): hybrid scoring across 6 signals, adaptive thresholds, a tiered guardrail, same-run overrides, and a 2-tier cross-run override system.

Pulled and analyzed real PROD clustering logs (near-miss diagnostics, which log by default) across a 7-day sample (19 of ~57 runs) plus hand-verified real merges:

- **92 `CROSS_RUN_NEAR_MISS` events** sampled. Of the 85 within the Tier B bypass's eligible window, only **2 (2.4%)** had `tierb_margin_bypass_would_fire: true`.
- **Denominator:** 133 stories created vs 86 attached across the same sample (~39% attach rate this week) — a materially higher rate than the 1.4 lifetime ratio implies, suggesting recent tuning already works reasonably well on a like-for-like basis.
- **8/8 hand-verified live Tier A merges were correct** (same real-world event on both sides, including a subtle SCOTUS-ruling carve-out case) — the corroboration mechanism itself (slug/entity/title-token overlap resolving near-tied embedding scores) is trustworthy.
- Most near-misses beyond the bypass window are separated by **100+ days** (up to ~160 days) with high embedding similarity from generic recurring political phrasing (e.g., "Trump [X] again") — these are very likely correctly-rejected non-matches (different real events), not missed merges.

## Root Cause (AC2)

Two distinct, independent findings — not one:

1. **A small, real, already-built gap:** `ENABLE_TIERB_MARGIN_BYPASS` (the flag that lets corroboration — shared entity/slug/title-token — resolve near-tied embedding candidates within a 48h window) defaults to `false` in code and was never set in either RSS workflow. It has been computing and logging what it *would* do (shadow mode) with no live effect. Tier A runs the identical logic unconditionally today with a clean track record.
2. **The actual explanation for the low lifetime ratio is structural, not a clustering bug.** Article-to-story clustering operates on a rolling 72-hour window per story. That's a deliberate, correct guard against merging unrelated events that happen to share generic phrasing months apart — loosening it broadly would trade rare missed merges for real false-merge risk. But it also means **the architecture has no way to represent one ongoing narrative thread spanning weeks or months** (Epstein, ICE-style coverage) — which has nothing to do with scoring quality and can't be fixed by tuning clustering. That's a different capability entirely (a "thread" layer grouping multiple already-correct stories together over time), which is prerequisite work for the future Important Stories Tracker concept, not something to build here.

## Recommendation (AC3)

**Enable `ENABLE_TIERB_MARGIN_BYPASS=true`** in both `rss-tracker-prod.yml` and `rss-tracker-test.yml`. Low effort (one-line config change per workflow, already made in this change), zero cost, correctness-verified via the Tier A analog. Expected impact: **~6 additional article attaches/week (~2% volume increase)** — a real, worthwhile, but modest win. It does **not** materially move the 1.4 lifetime ratio, and should not be sold internally as "the clustering fix."

**Do not** widen the 72h/48h time windows or loosen the guardrail broadly — the evidence (100+ day near-misses that look like generic-phrasing collisions) shows this would introduce false merges of unrelated events, not just approve legitimate ones.

**No standalone historical backfill using this fix.** A pure re-run of the corrected logic against the existing 12,088 stories would yield the same ~2-3% order-of-magnitude improvement — not worth a dedicated project on its own. See "Deferred Work" below.

## Change Made This Session

- `.github/workflows/rss-tracker-prod.yml`: added `ENABLE_TIERB_MARGIN_BYPASS: ${{ vars.ENABLE_TIERB_MARGIN_BYPASS || 'true' }}` — defaults ON, matching the `ENABLE_LEGACY_STORY_ENRICHMENT` kill-switch pattern (Codex review caught the original hardcoded `'true'`, which would have required a workflow-file PR to roll back instead of a repo-variable flip).
- `.github/workflows/rss-tracker-test.yml`: same change, for parity (TEST is manually triggered so no schedule risk).
- No code changes to `hybrid-clustering.js` itself — the bypass logic already exists and is tested via months of shadow-mode logging.

### Rollout / Monitoring

- Piggybacks on the existing ADO-528 3-day PROD monitoring window (Stories Claude Agent cutover) — no separate monitoring job needed.
- Watch `CLUSTERING_SUMMARY` log lines for `attached_324_tier_b > 0` (currently 0 in every sampled run) to confirm the flag is taking effect.
- Spot-check a few Tier B attaches the same way Tier A was verified (pull `article_id`/`story_id` pairs from `CROSS_RUN_OVERRIDE` logs with `tier:"B"`, compare real headlines) after a few days of live data.

### Rollback

Set the `ENABLE_TIERB_MARGIN_BYPASS` **repo variable** to `'false'` (GitHub → Settings → Secrets and variables → Actions → Variables) for instant rollback — no code change or PR needed. No data migration, no state to unwind — it only affects the decision at clustering time for new articles going forward.

---

## Deferred Work (AC4 — two separate future tickets, not scoped here)

1. **Narrative/thread tracking layer** — ADO-530. Design a mechanism to group multiple already-correctly-clustered stories into one ongoing narrative thread across weeks/months (e.g., Epstein, ICE). This is the actual prerequisite for a future "Important Stories Tracker" feature (surfacing/tracking only major ongoing threads instead of treating every story equally) — not scoped in this doc, needs its own discovery + plan.
2. **Historical backfill / re-cluster of legacy stories** — ADO-531. Re-evaluate existing stories against each other with whatever improved method exists at the time. Recommend **not** doing this as a standalone project against just the Tier B bypass fix (too low-yield per the analysis above) — bundle it with the thread-tracking work once that's scoped, since building the thread-merge machinery once and running one backfill pass is more efficient than backfilling twice.

---

## Appendix: Raw Evidence & Methodology (for future reference — avoid re-running the same diagnostics)

### What's already ruled out (don't re-investigate)

- **Candidate generation is not the bottleneck.** `candidate-generation.js`'s OR-blocking (time 72h / entity overlap / ANN top-60 / slug match, 200-candidate cap) is generous. Sampled near-miss `candidate_count` values ranged 146-200 — the right story is reliably present in the candidate pool; the issue (where one exists at all) is in scoring/gating, not recall.
- **Tier A bypass mechanism is trustworthy.** 8/8 hand-verified live merges were correct (see table below). Do not re-audit Tier A without new evidence of a problem.
- **Widening the 72h/48h time windows is not a good idea.** Near-misses beyond the window are dominated by 100+ day (up to ~160 day) gaps with high embedding similarity from generic recurring phrasing — these look like correctly-rejected different events, not missed merges. Confirmed via the per-entry `time_diff_hours` values below.
- **Enrichment-pipeline interaction is fine as-is.** `attachToStory()` (`hybrid-clustering.js:1742-1867`) never touches `last_enriched_at`/`enrichment_meta`, but the Stories Claude Agent's Step 2 query (`prompt-v1.md` line 179) already re-picks any story where `last_enriched_at < 12h ago` regardless of cause — so a late merge into an already-enriched story self-corrects within a bounded ≤12h window. Not a gap worth fixing.

### Near-miss `blocked_by` breakdown (16-entry, 1-day sample; 7-day sample below has the scaled version)

| Blocker | Count | % |
|---|---|---|
| margin | 15 | 94% |
| time | 11 | 69% |
| guardrail | 8 | 50% |
| corroboration | 2 | 13% |
| embed | 2 | 13% |

`tierb_margin_bypass_would_fire: true` in only **1 of 16** (6%) — most "margin" blocks also had "time" or "guardrail" as a co-blocker, so the bypass alone wouldn't resolve them. The one clean example: article `art-b4356c4d` → story 12118, `embed_best=0.902`, `time_diff_hours=13.5`, `blocked_by=["margin"]` only, `tierb_margin_bypass_would_fire_via="title_token"`.

**7-day scaled sample (19 of ~57 runs):** 92 near-miss events, 85 eligible (7 outside the ≤48h bypass window entirely), **2/85 (2.4%) would-fire=true** → extrapolated **~6 additional attaches/week** against a ~250-260/week base.

### Concrete example: July 4th "Salute to America 250" speech fragmented across 5 stories (PROD, live 2026-07-05)

| Story ID | Headline | source_count |
|---|---|---|
| 12118 | "Trump launches America's 250th birthday celebrations..." | 5 (created first) |
| 12145 | "Crowds Evacuated as Storms Menace Washington Ahead of Trump Speech" | 2 |
| 12147 | "In Fourth of July Speech, Trump Celebrates America and Derides Foes" | 1 |
| 12148 | "Trump hails 'golden age of America'..." | 1 |
| 12165 | "WATCH: Trump delivers keynote address at 'Salute to America 250'..." | 1 |

Other singleton headlines reviewed in the same sample (NATO funding, Pelosi's husband car incident, Bill Archer obituary, Iran prayer service, Doug Jones profile) read as genuinely distinct events — not evidence of missed merges. The July 4th cluster is the clearest real fragmentation example found.

### 8/8 hand-verified live Tier A merges (real headlines pulled via PostgREST, PROD)

| Article title | Story `primary_headline` | Verdict |
|---|---|---|
| Julia Letlow wins GOP primary, LA | "Republican trying to out-MAGA Trump's pick to a Senate victory" | Correct — same primary race |
| "Housing bill Trump refuses to sign heads to his desk" | "Johnson Says He Will Send Housing Bill to Trump" | Correct |
| "SCOTUS rules Trump can fire leaders of independent agencies" | "SCOTUS, for now, blocks Trump from firing Fed board member Lisa Cook" | Correct (same ruling, Fed carve-out facet) |
| "SCOTUS rejects Trump's challenge to counting late mail-in ballots" | same wording, story side | Correct |
| "SCOTUS rules against Trump in quest to fire Fed Gov. Lisa Cook" | "SCOTUS says Fed's Cook can keep her job... upholds other Trump firings" | Correct |
| "NJ Rep. Tom Kean returns to Congress after mysterious absence" | "Kean Set to Speak at Capitol After Mysterious Absence" | Correct |
| "Judge Blocks Postal Service From Imposing Restrictions on Mail-In Ballots" | "US judge blocks Trump bid to limit mail-in voting" | Correct |
| "Trump hijacks the US at 250 celebrations" (podcast) | "Trump hijacks America at 250 celebrations – podcast" | Correct — same episode |

### Methodology (reproducible commands)

```bash
# List recent PROD runs
gh run list --repo AJWolfe18/TTracker --workflow="rss-tracker-prod.yml" --limit 100 --json databaseId,createdAt,conclusion

# Pull near-miss log lines from a run
gh run view <id> --repo AJWolfe18/TTracker --log 2>&1 | grep -o '"type":"CROSS_RUN_NEAR_MISS".*'
# NOTE: the grep match starts mid-object (no opening brace) but DOES include the real closing brace.
# When parsing with node, prepend only "{" — do NOT also append "}" or JSON.parse fails
# ("Unexpected non-whitespace character after JSON"). This exact mistake was made once already.
JSON.parse("{" + line)   // correct
JSON.parse("{" + line + "}")  // WRONG - double brace

# Pull clustering summary lines (attach-path totals)
gh run view <id> --repo AJWolfe18/TTracker --log 2>&1 | grep -o '"type":"CLUSTERING_SUMMARY".*'

# Read-only PROD data access without SQL/MCP: extract the PROD anon key from
# public/supabase-browser-config.js (intentionally public/browser-facing) and hit PostgREST
# directly with minimal-field selects (select=id,primary_headline / select=id,title), always
# with &limit=. Never select embedding_v1/centroid_embedding_v1/content/scraped_html.
```

---
---

# Part 2: Clustering Quality v2 — Target Architecture & Roadmap

**Created:** 2026-07-05 (architecture session with Josh, post-ADO-529)
**Status:** Plan of record — a new session executes from here
**Budget impact:** All new work rides existing Claude cloud-agent infrastructure (same as SCOTUS/EO/Pardons/Stories agents). No new OpenAI spend. Marginal cost of the Judge agent at 1-3 runs/day is a fraction of the Stories agent's existing 12 runs/day.

## Why v2 (honest assessment of where we went wrong)

The system is ~8 months old and has accumulated ~20 tuning tickets (TTRC-230→357). The problems are architectural, not threshold-sized:

1. **Tuning without ground truth.** Clustering never had a durable, repeatable eval set — only a one-off CSV export + regex labeling (`scripts/export-clustering-golden-set.mjs`, `scripts/label-clusters.mjs`) and TTRC-329 shadow logging. Every gate/threshold change was validated against anecdotes. Meanwhile a real eval harness DOES exist for enrichment (`scripts/evals/`, `docs/features/ai-evals/plan.md`, 2026-02-24) — its pattern is reusable; don't rebuild it.
2. **Decisions are permanent.** Inline clustering is greedy attach-or-create with no story-to-story merge, so fragmentation is unrepairable (July 4th speech = 5 stories, Part 1 appendix). Because a false merge can never be undone, every guardrail rationally biases toward "create new story" — fragmentation is the guaranteed side effect of safety, with no counterbalancing repair. A deterministic merge pass existed once (TTRC-231, now `scripts/archive/merge-split/`) but was tied to the retired job-queue-worker and had no semantic judgment.
3. **Deterministic gates doing a semantic job.** Political-news embeddings are compressed (everything-Trump sits 0.80+ vs everything-else-Trump), so all hard decisions live in the 0.85-0.92 band — exactly where slug tokens / entity Jaccard / title overlap are weakest. Titles are often misleading, so token heuristics can't answer "same real-world event?" That's a judgment call and needs an LLM.
4. **Scoring debt.**
   - `ENTITY_STOPWORDS` (scoring.js) is a hardcoded list — it won't scale as new saturating entities emerge (RFK, Iran, White House officials). Needs frequency-based down-weighting, not manual list maintenance.
   - Title score computes TF-IDF over a 2-document corpus — IDF is meaningless there; it's token overlap with odd weighting, yet carries 25% of the score.
   - Title is compared only against `primary_headline` (whatever the FIRST article said), so multi-facet events ("storms evacuate crowds before speech" vs "Trump hails golden age") score ~0 on the same event.
5. **72h is the right window for the wrong question.** For "story = one news event," 72h is correct (Part 1 evidence: 100+ day near-misses are generic-phrasing collisions). Epstein/Iran-class sagas are *narratives made of many correct stories* — a second grouping layer, not a wider window.

## Target architecture: three layers

| Layer | Groups | Horizon | Mechanism | Status |
|---|---|---|---|---|
| 1. Inline clustering | articles → stories (one event) | ~72h (keep) | current deterministic pipeline + **inline LLM adjudication in the ambiguous band** (see below) | exists / build |
| 2. Clustering Judge | fragments of same event → merged story; audit of attaches | ~7-day lookback, runs **3x/day** (Josh decision 2026-07-05) | **new Claude cloud agent** (Sonnet) | build |
| 3. Narrative threads | stories → ongoing sagas (Epstein, Iran) | months | LLM assignment; = events-tracker feature | design (ADO-530) |

**Why judge in BOTH places (Josh, 2026-07-05):** inline judgment prevents fragment stories from being *created*, so we never spend enrichment on them (every avoided fragment = one avoided Stories-agent enrichment + one less duplicate card on the site). The after-the-fact Judge catches what inline missed — cross-run fragmentation and misleading-title cases that need more context than an inline call has — and audits quality. Both use the same judgment criteria and write to the same log, and both are validated against the same gold set.

**Philosophy change for Layer 1:** with a repair layer behind it, inline clustering should stay conservative — when unsure, create a new story. Merging later is easy; splitting a wrong merge is hard. Fragmentation becomes cheap; false merges stay the thing Layer 1 must avoid.

## The Clustering Judge agent (Layer 2) — design sketch

Same cloud-agent skeleton as SCOTUS/EO/Pardons/Stories (env bootstrap, PostgREST via curl, gold set validation, prompt-vN.md in repo, RemoteTrigger cron). This answers "can we build it like the existing agents" — yes, deliberately.

- **Cadence:** 3x/day (Josh decision 2026-07-05).
- **Inputs per run:**
  - Candidate story pairs from the last ~7 days: server-side centroid similarity (existing `get_embedding_similarities`-style RPC — never fetch embeddings client-side, egress rule #11) + shared non-stopword entities + close creation times.
  - Recent Tier A/B cross-run attaches for spot-audit (pull from `CROSS_RUN_OVERRIDE` logs or an attach-provenance table).
- **Judgment:** "Are these the same real-world event?" using story headlines, summaries, **article-level titles** (story headline alone is misleading — first-article framing), entities, dates. **Default DENY** — merge only when clearly the same event. Uncertain → flag for review, don't merge.
- **Actions:**
  - Execute merges via merge machinery (below). **Auto-merge confirmed (Josh, 2026-07-05)** — no human approval gate at the story layer; human approval is saved for the events/narrative layer.
  - Write a judgment log row for EVERY decision to a new `clustering_judge_log` table: story pair (IDs + headline snapshots), verdict (merge/keep/uncertain), confidence, one-sentence rationale, whether a merge was executed, source (`inline` | `judge-agent`). This is the lightweight quality-tracking Josh asked for — auditable in one query, and doubles as training data for gold-set expansion.
  - **Admin dashboard visibility:** add a "Judge" tab to admin.html (same pattern as the existing Skips tab) showing recent verdicts with headlines side-by-side, so review-and-adjust takes minutes not log archaeology. Because losers are tombstoned (never deleted), a bad merge spotted in review is reversible.
  - Heartbeat row on empty runs (same pattern as stories_enrichment_log, see claude-agent-patterns memory).
- **Safety rails:** per-run merge cap (~10), kill switch = disable trigger, 3-day monitoring window at rollout (same playbook as ADO-528), dry-run mode first (verdicts only, no merges) validated against the gold set before any live merge.
- **Merge machinery (build once — also serves ADO-531 backfill later):** repoint `article_story` rows idempotently; recompute centroid/entity_counter/top_entities/source_count on the survivor; keep the losing story as tombstone/redirect (never delete — reversibility + audit); handle enrichment state (merged story re-enriches via existing `last_enriched_at` staleness logic, see Part 1 "Enrichment-pipeline interaction").

## Inline ambiguous-band adjudication (Layer 1 addition)

Prevents fragments at creation time so we never enrich them (Josh, 2026-07-05: "inline keeps us from enriching things we don't need to" — correct).

- **Trigger:** only when the RSS run is about to CREATE a new story despite a high-similarity existing candidate — roughly the band where best embed ≥ ~0.85 and gates disagree (exact band defined against the gold set). Expected volume ~30-60 calls/day.
- **Mechanism:** direct API call from `hybrid-clustering.js` (Node, inside the GitHub Actions run — a cloud agent can't be invoked mid-run). GPT-4o-mini via the existing `OPENAI_API_KEY` is the zero-new-secrets path; Haiku is the alternative if we add an Anthropic key. Cost: **<$1/month** either way. Budget-guarded via the existing `budgets` table check.
- **Judgment:** same criteria and same default-DENY rule as the Judge agent; on API failure or timeout, fall back to current deterministic behavior (create new story) — the Judge agent repairs later, so inline is never load-bearing.
- **Logging:** writes to the same `clustering_judge_log` table with `source='inline'`.
- **Kill switch:** `ENABLE_INLINE_CLUSTER_JUDGE` repo-variable-overridable flag, same pattern as `ENABLE_TIERB_MARGIN_BYPASS`.
- **Sequencing:** ships AFTER the Judge agent is live — the Judge's logged verdicts prove the judgment criteria work in production before we let those criteria make permanent inline attach decisions.

## Eval harness + clustering gold set (do this FIRST)

- Reuse the `scripts/evals/` harness pattern. Build `~150-200` labeled pairs: same-event / different-event / hard cases. Seed sources already in hand: Part 1's 8 hand-verified Tier A merges, the July 4th 5-story fragmentation, near-miss log samples (misleading-title cases), 100+ day generic-phrasing collisions (labeled DIFFERENT — they anchor the false-merge side).
- Labeling: LLM-assisted first pass, Josh/Claude hand-verify — same as SCOTUS gold set was built.
- Two consumers: (a) replay harness for inline scoring/threshold changes (precision/recall report), (b) Judge prompt validation in dry-run mode (verdict accuracy on gold pairs before live merges are enabled).
- **Gate:** no scoring/threshold/gate change ships without a gold-set run. This ends anecdote-driven tuning.

## Scoring rework (Layer 1) — AFTER the eval set exists

- Replace static `ENTITY_STOPWORDS` with frequency-based down-weighting (entity document-frequency over a trailing 30-60 day corpus, cached in DB, refreshed by the RSS run) so US-RFK / LOC-IRAN / new saturating entities self-adjust without code changes.
- Fix title scoring: drop the 2-doc TF-IDF; use the existing meaningful-token overlap machinery, and compare against recent article titles in the story, not just `primary_headline`.
- Re-tune weights/thresholds against the gold set; then **delete** gate epicycles the Judge makes redundant (Tier B bypass lattice is the first candidate) rather than adding more.

## Explicitly NOT doing

- NOT widening 72h/48h windows (Part 1 evidence stands).
- NOT running historical backfill before the Judge + merge machinery exist (ADO-531 stays blocked on the Judge work, not just on ADO-530).
- NOT designing "threads" as a third concept — **ADO-530 and `docs/features/events-tracker/design.md` are the same feature.** The thread/narrative layer IS the events-tracker (sagas + one-shots). The 530 design session must reconcile with that doc and resolve its 9 rejected-schema issues, and stories→events assignment should be LLM judgment (story volume ~19/day makes this ~free, piggybacked on or parallel to the Stories agent cadence).

## Sequencing

1. **Eval harness + clustering gold set** (1 session, ADO-532) — everything else is gated on it.
2. **Clustering Judge agent** (1-2 sessions, ADO-533): merge machinery + `clustering_judge_log` + admin Judge tab + prompt + dry-run validation vs gold set → enable live auto-merges with cap + monitoring window, 3x/day.
3. **Inline ambiguous-band adjudication** (1 session, ADO-535) — after Judge verdicts prove out in production.
4. **Scoring rework** (1 session, ADO-534), tuned against gold set; delete redundant gates.
5. **ADO-530 design session** — narrative/events layer, reconciled with events-tracker design doc.

## Decisions (Josh, 2026-07-05)

1. **Judge cadence: 3x/day.**
2. **Auto-merge: yes** — no per-merge human approval at the story layer. Quality tracking via `clustering_judge_log` + admin Judge tab (headlines side-by-side, verdict, rationale) for fast review-and-adjust; merges are reversible (tombstones, never deletes). Human approval is reserved for the events/narrative layer.
3. **Model: Sonnet** for the Judge agent; GPT-4o-mini (existing key) for the inline call.
4. **Judge inline AND after the fact** — inline prevents fragment creation (saves enrichment spend + avoids duplicate cards); the Judge agent repairs cross-run misses and audits. Shared criteria, shared log, shared gold set.

---

## Implementation notes for executing sessions

Deliberately NOT full code — each story session follows the normal code → review → QA workflow, and the key tunables (band thresholds, prompt wording, weights) must come from gold-set data, not be guessed here. This section is what a cold-start session needs to begin without re-deriving.

### ADO-532: Eval harness + gold set

> **Built 2026-07-05.** Correction to the note below: the `scripts/evals/` harness had been
> DELETED in commit `2c7572f` (April 2026, legacy-GPT retirement) — the generic skeleton
> (run-eval.js, eval-types.js) was restored from git history and generalized rather than
> rebuilt. Delivered: 208-pair gold set + offline replay runner + baseline
> (bypass OFF: P=100%/R=40.0%, 100% replay-vs-live agreement; bypass ON (current PROD):
> P=98.1%/R=53.0%). Full numbers, file inventory, and CLI usage:
> `docs/features/ai-evals/plan.md` § Clustering Eval. Known limitation: the Tier A/B cascade
> is transcribed in clustering-eval.js (live code inlines it in clusterArticle) — extract a
> shared pure function during ADO-534, gated on this gold set.

- **Location:** extend the existing harness — `scripts/evals/` (see `docs/features/ai-evals/plan.md` for its structure). Add `scripts/evals/clustering-eval.js` + `scripts/evals/clustering-gold-set.json`. Do NOT build a new harness.
- **Gold set entry shape (per pair):**
  ```json
  {
    "id": "gs-001",
    "pair_type": "article_story | story_story",
    "a": { "title": "...", "entities": ["..."], "published_at": "...", "topic_slug": "..." },
    "b": { "headline": "...", "top_entities": ["..."], "article_titles": ["..."], "date_range": "..." },
    "label": "same_event | different_event",
    "difficulty": "easy | hard",
    "source": "tier_a_verified | near_miss | july4_fragmentation | generic_collision | new",
    "notes": "why this label"
  }
  ```
- **Seed data (already collected, Part 1 appendix):** 8 hand-verified Tier A merges (label: same_event), July 4th 5-story cluster (all pairs same_event), near-miss log entries (mixed — hand-label), 100+ day generic-phrasing collisions (label: different_event — these anchor the false-merge side). Near-miss extraction commands are in Part 1 Methodology. Include misleading-title cases deliberately.
- **Runner outputs:** precision/recall/F1 vs labels for (a) current deterministic scoring — replay `calculateHybridScore` + guardrail offline against each pair; (b) LLM verdicts — run the judge prompt over pairs (dry run). Store per-pair sims/scores IN the gold set file at build time so re-runs don't refetch embeddings (egress rule #11).
- **Labeling flow:** LLM-assisted first pass, then hand-verify (same as the SCOTUS gold set was built). ~150-200 pairs.

### ADO-533: Clustering Judge agent

- **Files:** `docs/features/clustering-judge/{plan.md, prompt-v1.md}` mirroring `docs/features/stories-claude-agent/` structure. RemoteTrigger cron 3x/day (e.g., `0 5,13,21 * * *` — offset from RSS runs). All the RemoteTrigger/bootstrap gotchas are in `claude-agent-patterns` memory (git reset in bootstrap, full nested job_config on update, etc.).
- **`clustering_judge_log` DDL sketch (new migration):**
  ```sql
  CREATE TABLE IF NOT EXISTS clustering_judge_log (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source TEXT NOT NULL CHECK (source IN ('inline','judge-agent')),
    story_id_a BIGINT,          -- nullable: heartbeat rows
    story_id_b BIGINT,          -- nullable: heartbeat + audit rows
    headline_a TEXT, headline_b TEXT,   -- snapshots (survive merges/edits)
    verdict TEXT CHECK (verdict IN ('merge','keep','uncertain')),
    confidence NUMERIC, rationale TEXT,
    merged BOOLEAN NOT NULL DEFAULT FALSE,
    run_id TEXT
  );
  ```
  Remember the migration-046 gotcha: new table needs explicit GRANT if admin dashboard reads it via anon; and REVOKE FROM PUBLIC on any new SECURITY DEFINER RPC (migrations 095/096 pattern).
- **Merge machinery:** new RPC `merge_stories(p_loser_id, p_survivor_id)` doing, in one transaction: repoint `article_story` rows (idempotent — skip rows already on survivor), recompute survivor centroid server-side (avg of member article embeddings — never ship embeddings to the client), merge `entity_counter`/`top_entities`, recount `source_count`, set loser to a `merged` state + new `merged_into_story_id` column (tombstone/redirect — never delete). Frontend/edge functions must exclude merged-state stories from active queries (check `stories-active` edge function).
- **Candidate pair query:** server-side RPC returning story pairs from last 7 days with centroid similarity ≥ ~0.85 AND ≥1 shared non-stopword entity, capped (~30 pairs/run). No embedding egress.
- **Agent prompt shape:** Step 1 fetch candidate pairs via RPC; Step 2 per pair, fetch story summaries + member ARTICLE titles (not just primary_headline); Step 3 verdict with default-DENY + one-sentence rationale; Step 4 execute merge RPC only for 'merge' verdicts up to cap; Step 5 log every verdict; Step 6 heartbeat row if zero candidates. Audit mode: also re-judge a sample of the week's Tier A/B attaches, log verdicts (no action — flag only).
- **Rollout:** dry-run mode (verdicts logged, `merged=false` forced) → compare against gold set + Josh spot-review in admin tab → enable live merges (cap 10/run) → 3-day monitoring window (ADO-528 playbook).

### ADO-535: Inline adjudication

- **Call site:** `hybrid-clustering.js`, immediately before `createNewStory()` is reached with a high-embed best candidate (band ~≥0.85, finalized from gold set). Reuse the OpenAI client pattern from the enrichment scripts; ~10s timeout; ANY failure → fall back to current behavior (create story — Judge repairs later). Check `budgets` table before calling (rule #11/#5).
- **Flag:** `ENABLE_INLINE_CLUSTER_JUDGE: ${{ vars.ENABLE_INLINE_CLUSTER_JUDGE || 'false' }}` in both RSS workflows — note default OFF at ship, flipped after validation (opposite of the TIERB flag default).
- **Logs to** `clustering_judge_log` with `source='inline'`.

### ADO-534: Scoring rework

- Entity document-frequency: new small table (entity_id, doc_count, window_start) refreshed at the end of each RSS run from recent articles; `calculateEntityScore` weights by inverse frequency instead of the binary `ENTITY_STOPWORDS` list (keep the list as a floor during transition).
- Title: replace `calculateTitleScore`'s 2-doc TF-IDF with the meaningful-token overlap machinery already in `hybrid-clustering.js` (`getMeaningfulTokenOverlap`), compared against recent member article titles, not just `primary_headline`.
- Every change lands with a before/after gold-set report in the PR description.

### Admin "Judge" tab (part of ADO-533)

- `admin.html` is standalone vanilla JS — follow the Skips tab pattern exactly (see ADO-466 work). Columns: date, source, headline A vs headline B side-by-side, verdict, confidence, rationale, merged?. Filter by verdict + source. Read via PostgREST with `select=` field list + `limit`.
