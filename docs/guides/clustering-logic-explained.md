# Story Clustering Logic Explained

This guide explains how TrumpyTracker clusters articles into stories - the complete pipeline from candidate generation through final decision.

---

## Overview

When a new article arrives, the clustering system must answer: **"Does this belong to an existing story, or is it a new story?"**

The process has two phases:
1. **Candidate Generation** - Find 50-200 potentially matching stories (fast, high recall)
2. **Scoring & Decision** - Score each candidate and pick the best match (accurate, threshold-based)

---

## Phase 1: Candidate Generation

**Goal:** Find all stories that MIGHT match this article. We'd rather have false positives (extra candidates) than miss the true match.

**Strategy:** OR-blocking - Run 4 independent queries, combine results, deduplicate.

### The 4 Candidate Blocks

| Block | What It Does | Typical Count | Query Method |
|-------|--------------|---------------|--------------|
| **Time** | Stories with articles in ±72h window | 60-70 | `latest_article_published_at` filter |
| **Entity** | Stories sharing named entities (people, orgs, places) | 0-90 | `top_entities` array overlap (GIN index) |
| **ANN** | Top-60 most similar by embedding vector | 60 (capped) | `find_similar_stories` RPC (pgvector HNSW) |
| **Slug** | Stories with same topic slug | 0-5 | `topic_slugs` array contains |

### What Each Block Means

**Time Block (60-70 candidates)**
- Finds stories that had articles published within 72 hours of this article
- Uses `latest_article_published_at` (when the most recent article was published)
- This is the broadest net - catches any temporally related story

**Entity Block (0-90 candidates)**
- Extracts named entities from article: `US-TRUMP`, `ORG-DOJ`, `LOC-VENEZUELA`
- Finds stories whose `top_entities` array overlaps
- Filters out "stopword" entities that appear everywhere: `US-TRUMP`, `US-BIDEN`, `LOC-USA`, `ORG-WHITE-HOUSE`, etc.
- **If article only has stopword entities → returns 0 candidates**

**ANN Block (always 60)**
- ANN = **Approximate Nearest Neighbors**
- Uses the article's embedding vector (1536-dimensional semantic representation)
- Queries pgvector HNSW index for top-60 most similar story centroids
- Returns similarity score (0.0-1.0) for each match
- **This is capped at 60 by `ANN_LIMIT` constant**

**Slug Block (0-5 candidates)**
- Uses `topic_slug` extracted from article (e.g., `TRUMP-VENEZUELA-MADURO`)
- Finds stories that have this slug in their `topic_slugs` array
- Very precise but low volume

### Candidate Limits

```javascript
ANN_LIMIT = 60          // Max candidates from ANN block
MAX_CANDIDATES = 200    // Total cap after deduplication
```

If combined candidates exceed 200, we take the first 200 (time block has priority since it's queried first).

---

## Phase 2: Hybrid Scoring

Each candidate story is scored against the article using 6 weighted signals:

| Signal | Weight | What It Measures |
|--------|--------|------------------|
| **Embedding** | 45% | Semantic similarity (cosine distance of vectors) |
| **Title** | 25% | TF-IDF similarity of headlines |
| **Entity** | 12% | Jaccard overlap of non-stopword entities |
| **Time** | 10% | Decay bonus (full points within 72h) |
| **Geography** | 8% | Location entity overlap |
| **Keyphrases** | 0% | Disabled (was broken) |

**Total Score = Weighted sum, range 0.0 - 1.0+** (bonuses can exceed 1.0)

### Bonuses

| Bonus | Value | Trigger |
|-------|-------|---------|
| Topic Slug Match | +0.08 | Same `topic_slug` |
| Shared Artifacts | +0.06 | Same PDF/FR document |
| Quote Match | +0.05 | Shared quotes |
| Same Outlet | +0.04 | Same source domain |

---

## Phase 3: Decision Logic

After scoring, the system decides which path to take. Articles are processed through these decision points in order:

### Decision Tree

```
1. Already clustered? → SKIP (decision: "skipped")

2. Exact title match in this run? → ATTACH (attach_path: "exact_title")

3. Generate candidates & score them

4. Best score >= threshold AND passes guardrail? → ATTACH (attach_path: "normal")

5. Same-run override eligible? → ATTACH (attach_path: "same_run")
   (embed >= 0.85, story created THIS run, below threshold but high embed)

6. Cross-run Tier A override? → ATTACH (attach_path: "cross_run_tier_a")
   (embed >= 0.90, story within 48h, margin >= 0.04)

7. Cross-run Tier B override? → ATTACH (attach_path: "cross_run_tier_b")
   (embed >= 0.88, story within 72h, needs corroboration: slug/entity/title token overlap)

8. Batch dedup match? → ATTACH (attach_path: "batch_dedup")
   (matches story created earlier in same batch run)

9. No match found → CREATE new story (decision: "created")
```

### Thresholds

| Article Type | Threshold | Detection |
|--------------|-----------|-----------|
| Wire (AP, Reuters) | 0.68 | Domain in wire list |
| Opinion | 0.76 | "opinion" in URL |
| Policy | 0.72 | Policy-related slug |
| Default | 0.70 | Everything else |

### Guardrail

Even if score exceeds threshold, article must pass guardrail:
- Embedding score >= 0.60, OR
- Title similarity >= 0.50

This prevents false positives from high entity/time overlap with unrelated content.

---

## Understanding the Canonical Logs

### ARTICLE_DECISION Log Fields

| Field | Meaning |
|-------|---------|
| `decision` | `attached` / `created` / `skipped` |
| `attach_path` | Which decision branch led to attach |
| `create_reason` | Why a new story was created |
| `candidate_count` | Total candidates after dedup |
| `candidate_sources` | `{time, entity, ann, slug}` - per-block counts |
| `candidate_capped` | True if hit 200 cap |
| `best_embed` | Highest embedding score among candidates |
| `best_story_id_by_embed` | Story with highest embedding (not necessarily attached) |
| `title_token_overlap` | Legacy token count |
| `title_token_overlap_enhanced` | With acronym detection |

### create_reason Values

| Value | Meaning | Action |
|-------|---------|--------|
| `no_candidates` | All 4 blocks returned 0 | Check entity extraction, embedding quality |
| `best_embed_below_tierb` | Best embed < 0.88 | Normal - article is genuinely different |
| `best_hybrid_below_threshold` | Embed >= 0.88 but hybrid score too low | Check other signals (title, entity, time) |
| `rejected_other` | Passed thresholds but blocked | Guardrail, margin gate, or corroboration failed |

### attach_path Values

| Value | When Used |
|-------|-----------|
| `exact_title` | Identical normalized title in same run |
| `normal` | Standard hybrid scoring above threshold |
| `same_run` | High embed but below threshold, story from this run |
| `cross_run_tier_a` | embed >= 0.90, within 48h, good margin |
| `cross_run_tier_b` | embed >= 0.88, within 72h, has corroboration |
| `batch_dedup` | Matches story created earlier in batch |

---

## Diagnosing Fragmentation

**Fragmentation** = Articles that should be in the same story end up in separate stories.

### Key Diagnostic Questions

1. **Are we finding the right story as a candidate?**
   - Check `candidate_sources` - is the expected block returning it?
   - If `entity: 0`, check if article only has stopword entities

2. **Is embedding similarity high enough?**
   - `best_embed >= 0.88` → eligible for override paths
   - `best_embed >= 0.90` → eligible for Tier A (no corroboration needed)
   - `best_embed < 0.88` → must pass normal hybrid threshold

3. **What's blocking the merge?**
   - `create_reason: no_candidates` → retrieval gap
   - `create_reason: best_embed_below_tierb` → genuinely different content
   - `create_reason: rejected_other` → passed thresholds but blocked by guardrail/margin

### Useful Queries

```bash
# Find retrieval gaps (no candidates)
grep ARTICLE_DECISION logs | grep '"create_reason":"no_candidates"'

# Find potential over-fragmentation (high embed but still created)
grep ARTICLE_DECISION logs | grep '"decision":"created"' | \
  jq 'select(.best_embed >= 0.85)'

# Check if ANN is working
grep ARTICLE_DECISION logs | jq '.candidate_sources.ann' | sort | uniq -c

# Find capped candidates (might be missing stories)
grep ARTICLE_DECISION logs | grep '"candidate_capped":true'
```

---

## Configuration Reference

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `LOG_CANONICAL_DECISIONS` | false | Enable ARTICLE_DECISION logs |
| `LOG_PHASE0_DIAGNOSTICS` | false | Enable verbose candidate logging |
| `THRESHOLD_DEFAULT` | 0.70 | Default hybrid score threshold |
| `GUARDRAIL_MIN_EMBEDDING` | 0.60 | Minimum embed for guardrail pass |
| `VERY_HIGH_EMBEDDING` | 0.90 | Tier A override threshold |

### Key Constants

```javascript
// candidate-generation.js
TIME_WINDOW_HOURS = 72    // Time block window
ANN_LIMIT = 60            // Max ANN candidates
MAX_CANDIDATES = 200      // Total candidate cap

// scoring.js
WEIGHTS = {
  embedding: 0.45,
  title: 0.25,
  entities: 0.12,
  time: 0.10,
  geography: 0.08
}

// hybrid-clustering.js
TIER_A_EMBED = 0.90       // Cross-run Tier A
TIER_B_EMBED = 0.88       // Cross-run Tier B
MARGIN_GATE = 0.04        // Embed margin for safety
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `scripts/rss/candidate-generation.js` | 4-block candidate retrieval |
| `scripts/rss/scoring.js` | Hybrid scoring formula |
| `scripts/rss/hybrid-clustering.js` | Decision logic, override paths |
| `scripts/rss/centroid-tracking.js` | Story centroid updates |

---

*Last updated: 2026-01-03*
