# AI Eval Foundation — Durable Reference

> Persistent documentation for the eval system. Survives across sessions.
> For implementation plan details, see the ephemeral plan in the session handoffs.

## Eval Contract (Standard for ALL Content Types)

Every evaluated item produces:
```json
{
  "content_type": "scotus|pardons|stories|eos",
  "content_id": 145,
  "prompt_version": "v3-ado354-concrete-facts",
  "model": "gpt-4o-mini",
  "run_id": "<timestamp>-<rand>",
  "timestamp": "<iso>",
  "dimensions": {
    "D1_severity_congruence": { "status": "pass|warn|fail|skip", "score": null, "notes": "" }
  },
  "blocking": true|false,
  "block_reasons": [],
  "warn_reasons": []
}
```

## Files

> **History note (2026-07-05):** the original harness (scotus-eval.js, shared-eval-utils.js,
> export-gold-review.js) was deleted in commit `2c7572f` (April 2026) when GPT enrichment was
> retired for Claude cloud agents. For ADO-532 the generic skeleton (run-eval.js, eval-types.js)
> was restored from git history and generalized: eval types now live in a registry inside
> run-eval.js and declare their own client needs. SCOTUS sections below are kept as historical
> record of the pattern.

| File | Purpose | Status |
|------|---------|--------|
| `scripts/evals/run-eval.js` | CLI runner with eval-type registry | active |
| `scripts/evals/eval-types.js` | Shared types, verdict logic, block config | active |
| `scripts/evals/clustering-eval.js` | Clustering gold-set replay (ADO-532) | active |
| `scripts/evals/clustering-gold-set.json` | 208 labeled same/different-event pairs | active |
| `scripts/evals/build-clustering-gold-set.js` | Rebuilds the gold-set DRAFT from PROD log extracts | active |
| `scripts/evals/scotus-eval.js` etc. | SCOTUS D1-D11 implementations | deleted in 2c7572f (restorable from git) |
| `scripts/scotus/gold-set.json` | 10 hand-verified SCOTUS cases | historical |
| `logs/evals/` | Output directory (JSONL + summary JSON per run, gitignored) | active |

## Clustering Eval (ADO-532, 2026-07-05)

- **Gold set:** 208 pairs (110 same_event / 98 different_event; 135 hard; 198 article↔story + 10 story↔story July-4th fragmentation pairs). Sources: PROD near-miss logs (118), 100+ day generic collisions (40), live Tier A/B attaches (40), July 4th cluster (10). Labeling principle + provenance are in the file's `meta` block. Similarities are decision-time values from PROD logs — the eval NEVER fetches embeddings (egress rule #11).
- **Runner:** replays `calculateHybridScore` + guardrail + Tier A/B cross-run cascade offline. story↔story pairs are skipped by the deterministic replay — they validate the Clustering Judge agent (ADO-533) in dry-run mode later.
- **THE GATE:** no clustering scoring/threshold/gate change ships without a before/after gold-set run in the PR description (plan of record: `docs/features/clustering-quality/plan.md` Part 2).

### Baseline (2026-07-05, 198 article↔story pairs)

> **Label status:** these are FIRST-PASS-LABEL baselines (Claude-labeled, slug/member-article
> verified for uncertain cases). Josh's spot-check is the ADO-532 closure gate — priority is
> the ~48 disagreement pairs (`--disagreements-only`), since a mislabel there moves the
> baseline directly. Update `meta.labeled_by`/`meta.verification_status` in the gold-set file
> once verified.

| Config | Precision | Recall | F1 | Replay-vs-live agreement |
|--------|-----------|--------|-----|--------------------------|
| Tier B bypass OFF (log-window config) | **100%** (0 FP) | 40.0% | 57.1% | **100%** (exact reproduction of live decisions) |
| Tier B bypass ON (current PROD, ADO-529) | 98.1% (1 FP) | 53.0% | 68.8% | 92.9% (delta = the flag) |

Reading: the deterministic system is precision-heavy by design — false merges ~0, but it misses ~half of true same-event pairs (fragmentation). The ADO-529 Tier B bypass buys +13pp recall for 1 false merge on this set. The remaining ~47 missed merges concentrate in the near-miss band (59.3% accuracy there) — that is the Clustering Judge agent's (ADO-533) repair target.

```bash
# Clustering baseline
node scripts/evals/run-eval.js --type=clustering
# Show only prediction/label disagreements
node scripts/evals/run-eval.js --type=clustering --disagreements-only
# Replay with the Tier B margin bypass disabled
TIERB_BYPASS=off node scripts/evals/run-eval.js --type=clustering
```

## SCOTUS Dimensions (D1-D11)

| # | Dimension | Type | Blocking? |
|---|-----------|------|-----------|
| D1 | Severity congruence | LLM judge | No (warn only) |
| D2 | Severity distribution | Deterministic (aggregate) | No |
| D3 | Tone-level alignment | LLM judge | No |
| D4 | Opener uniqueness | Deterministic (aggregate) | No |
| D5 | Section uniqueness | Deterministic | No |
| D6 | Factual accuracy | LLM judge | **Yes** |
| D7 | Issue area | Deterministic | **Yes** |
| D8 | Evidence anchors | Deterministic | **Yes** |
| D9 | Dissent integrity | Deterministic | **Yes** |
| D10 | Party specificity | Deterministic | **Yes** |
| D11 | Why-it-matters grounding | Deterministic | No |

## Gate Policy (Session 2+)

**BLOCK (hard fail / no publish):**
- D6: Factual contradictions vs source text
- D7: `issue_area` null or invalid enum
- D8: All-generic evidence anchors (section labels, not quotes)
- D9: String "null" or phantom dissent
- D10: Generic who_wins/who_loses

**WARN ONLY (never block):**
- D1, D2, D3, D4, D5, D11

## LLM Judge Config

- Model: `gpt-4o-mini`
- Temperature: 0
- Top P: 1
- Max tokens: 500
- Response format: `{ type: 'json_object' }`
- Judge prompt version tracked in eval output

## Gold Set (10 Cases)

| ID | Case | Expected Level | Current Level |
|----|------|---------------|--------------|
| 286 | Barrett v. US | 0-1 | 3 |
| 51 | Kirtz | 0-1 | 1 |
| 192 | Soto v. US | 0-1 | 1 |
| 4 | Connelly v. US | 2-3 | 4 |
| 64 | Royal Canin v. Wullschleger | 1-2 | 4 |
| 120 | Bufkin v. Collins | 3-4 | 3 |
| 133 | US v. Miller | 3-4 | 4 |
| 68 | TikTok v. Garland | 4-5 | 4 |
| 63 | Trump v. Anderson | 4-5 | 4 |
| 109 | Lackey v. Stinnie | 3-4 | 5 |

## Session 1 Baseline (2026-02-24)

TEST DB: 20 public cases.

| Metric | Value |
|--------|-------|
| Severity level 4-5 | **70%** (expected <40%) |
| issue_area null | **100%** |
| Generic evidence anchors | **95%** |
| String "null" fields | **20%** |
| Phantom dissent | **80%** |
| Generic parties | **0%** (good) |
| Similar opener pairs | **29** |
| **Contradiction rate** | **100%** (10/10 gold set) |
| Blocking error rate | **100%** |

### Root Causes Identified:
1. **issue_area never populated** — not in Pass 1 or Pass 2 output schema
2. **Evidence anchors are section labels** — prompt asks for section refs, not quotes
3. **String "null" not normalized** — `dissent_highlights = "null"` instead of actual null
4. **Severity overclaiming** — no base-rate guidance, GPT defaults to dramatic
5. **Tone undifferentiated** — most cases get same concerned/critical tone regardless of level
6. **D6 contradiction rate high** — partly real (fabricated dissents), partly LLM judge strictness on framing

## Session 2 Results (2026-02-24, Phase 2)

Prompt fixes applied + 10 gold cases re-enriched. 17 public cases in TEST.

| Metric | Baseline | Phase 2 | Change |
|--------|----------|---------|--------|
| Severity level 4-5 | 70% | **65%** | -5pp |
| issue_area null | 100% | **59%** | -41pp |
| Generic evidence anchors | 95% | **59%** | -36pp |
| String "null" fields | 20% | **0%** | FIXED |
| Phantom dissent | 80% | **76%** | -4pp |
| Generic parties | 0% | **0%** | same |
| Similar opener pairs | 29 | **10** | -19 |
| **Contradiction rate** | 100% | **71%** | -29pp |
| Blocking error rate | 100% | **88%** | -12pp |
| Gold cases passing | 0/10 | **2/7** | +29% |

### What worked:
1. **String null fixed entirely** — normalizeDissent() at write layer + prompt instruction
2. **issue_area populated** — 7/7 re-enriched gold cases have valid issue_area
3. **Evidence anchors now real quotes** — GPT generating verbatim quotes instead of section labels
4. **Severity improvement** — Soto correctly at level 1, Connelly at 3

### What's still broken:
1. **D6 contradiction rate still 71%** — GPT confusing disposition direction in editorial (says "reversed" when "affirmed", etc). LLM judge also overly strict on framing.
2. **D8 anchor grounding 71%** — GPT generates real quotes but exact-match fails (normalization gap in checkQuoteGrounding)
3. **Severity still high** — Barrett 9-0 people-win still at level 3 despite base-rate guidance
4. **D9 phantom dissent** — CourtListener metadata lacks dissent_authors for some cases with real dissents (Jackson, Gorsuch)

### Phase 3 candidates:
- D8 fix: fuzzy matching in checkQuoteGrounding (3-gram overlap instead of exact substring)
- D6 fix: tighten Pass 1→Pass 2 alignment (inject disposition into editorial template)
- Severity: stronger per-vote-count constraints in prompt
- Phantom dissent: backfill dissent_authors from opinion text headers

## Roadmap

| Session | Focus | Status |
|---------|-------|--------|
| 1 | Eval harness + gold set + baseline | **Done** |
| 2 | Prompt fixes + hard-fact gate + re-eval gold set | **Done** |
| 3 | Shadow Layer B + bulk re-enrich 20 TEST cases | Planned |
| 4 | Drift monitoring (optional) | Future |
| 5 | Generalize to pardons/stories/EOs | Future |

## Per-Content-Type Roadmap

| Content Type | Eval File | Gold Set | Status |
|-------------|-----------|----------|--------|
| SCOTUS | `scotus-eval.js` | `gold-set.json` (10 cases) | Session 2 done |
| Pardons | `pardons-eval.js` | TBD | Not started |
| Stories | `stories-eval.js` | TBD | Not started |
| EOs | `eos-eval.js` | TBD | Not started |

## CLI Usage

```bash
# Full baseline (gold + aggregate)
node scripts/evals/run-eval.js --type=scotus

# Gold set only (with LLM judges)
node scripts/evals/run-eval.js --type=scotus --gold-only

# Specific cases
node scripts/evals/run-eval.js --type=scotus --case-ids=4,51,68

# Deterministic only (no LLM cost)
node scripts/evals/run-eval.js --type=scotus --no-llm
```

## Cost

| Item | Cost |
|------|------|
| Full eval run (10 gold cases, 3 LLM dims each) | ~$0.006 |
| Gold set re-enrichment | ~$0.01 |
| Bulk re-enrich (20 TEST cases) | ~$0.06 |
| Bulk re-enrich (141 cases including unenriched) | ~$0.15 |
| **Total all sessions** | **~$0.25** |
