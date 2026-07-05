# Clustering Quality Audit — Findings & Recommendation (ADO-529)

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
