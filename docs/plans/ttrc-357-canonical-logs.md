# Plan: TTRC-357 Canonical Clustering Logs v0.1

**Status:** Ready to Implement
**JIRA:** TTRC-357
**Risk:** Low (additive logging behind flag, no behavior changes)
**Key File:** `scripts/rss/hybrid-clustering.js`

---

## Summary

Add canonical versioned logs for clustering decisions to diagnose fragmentation issues (retrieval vs threshold gap). Two new log types behind `LOG_CANONICAL_DECISIONS` flag.

---

## Schema v0.1

### ARTICLE_DECISION (one per article that enters clustering)
```json
{
  "type": "ARTICLE_DECISION",
  "schema_version": "0.1",
  "run_id": "1735920600000-a3f2c1",
  "article_id": "art-xxx",
  "decision": "attached" | "created" | "skipped",
  "skip_reason": "already_clustered" | null,
  "attach_path": "normal" | "exact_title" | "same_run" | "cross_run_tier_a" | "cross_run_tier_b" | "batch_dedup" | null,
  "create_reason": "no_candidates" | "best_embed_below_tierb" | "best_hybrid_below_threshold" | "rejected_other" | null,
  "candidate_count": 42,
  "candidate_sources": { "time": 15, "entity": 20, "ann": 12, "slug": 5 },
  "candidate_capped": false,
  "best_embed": 0.87,
  "best_story_id_by_embed": 123,
  "title_token_overlap": 2,
  "title_token_overlap_enhanced": 2
}
```

### RUN_SUMMARY_CANONICAL (one per run)
```json
{
  "type": "RUN_SUMMARY_CANONICAL",
  "schema_version": "0.1",
  "run_id": "1735920600000-a3f2c1",
  "articles_processed": 50,
  "articles_attached": 35,
  "articles_created": 15,
  "articles_skipped": 2,
  "attach_paths": { "normal": 20, "exact_title": 5, "cross_run_tier_a": 7, "cross_run_tier_b": 3 },
  "create_reasons": { "no_candidates": 5, "best_embed_below_tierb": 7, "rejected_other": 3 }
}
```

---

## Design Principles

1. **One log per article that enters clusterArticle()** - Log at each `return`, including skipped
2. **No double-logging** - Track logged articles in a Set to prevent duplicates
3. **create_reason uses only always-available facts** - Don't depend on Tier-B-only variables
4. **Helpers for safety** - `safeBlockResults()` and `blockResultCounts()` guarantee shape
5. **Run ID per-run, not per-process** - Generated fresh in resetRunState()
6. **best_story_id_by_embed** - Consistently uses top-by-embedding (what we're diagnosing)

---

## Implementation Steps

### Step 1: Add Feature Flag and Helpers (after line 67) ✅ COMPLETE

```javascript
// ============================================================================
// TTRC-357: Canonical Decision Logging
// ============================================================================

const LOG_CANONICAL_DECISIONS = process.env.LOG_CANONICAL_DECISIONS === 'true';
const MAX_CANDIDATES = 200;  // Reference for candidate_capped detection

// Run ID - generated fresh per run in resetRunState(), not at module load
let canonicalRunId = null;

// Track logged articles to prevent double-logging (cleared per run)
const loggedArticleDecisions = new Set();

/**
 * Safely extract blockResults from candidates array
 * Must call immediately after generateCandidates() before any array operations
 */
function safeBlockResults(candidates) {
  const br = candidates?.__blockResults;
  return br && typeof br === 'object'
    ? br
    : { time: [], entity: [], ann: [], slug: [] };
}

/**
 * Convert blockResults to counts for logging
 */
function blockResultCounts(br) {
  return {
    time: br.time?.length || 0,
    entity: br.entity?.length || 0,
    ann: br.ann?.length || 0,
    slug: br.slug?.length || 0,
  };
}

/**
 * Determine create_reason from always-available facts only
 * Uses 0.88 (Tier B threshold), not 0.85
 * Does NOT depend on Tier-B-only variables (margin, corroboration internals)
 */
function determineCreateReason(candidateCount, bestEmbed, bestTotal, threshold) {
  if (candidateCount === 0) return 'no_candidates';
  if (bestEmbed < 0.88) return 'best_embed_below_tierb';  // Below Tier B eligibility
  if (bestTotal < threshold) return 'best_hybrid_below_threshold';
  return 'rejected_other';  // Guardrail/margin/corroboration - v0.2 can expand
}

/**
 * Emit canonical ARTICLE_DECISION log (once per article)
 */
function emitArticleDecision({
  article,
  decision,
  skipReason = null,
  attachPath = null,
  createReason = null,
  candidateCount = 0,
  candidateCapped = false,
  blockResults = null,
  bestEmbedByEmbed = null,
  bestStoryIdByEmbed = null,
  titleOverlaps = null
}) {
  if (!LOG_CANONICAL_DECISIONS) return;

  // Defensive: ensure run_id exists (in case resetRunState wasn't called)
  if (!canonicalRunId) {
    canonicalRunId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  // Prevent double-logging
  if (loggedArticleDecisions.has(article.id)) {
    console.warn(`[TTRC-357] Double-log prevented for article ${article.id}`);
    return;
  }
  loggedArticleDecisions.add(article.id);

  const br = blockResults || { time: [], entity: [], ann: [], slug: [] };

  console.log(JSON.stringify({
    type: 'ARTICLE_DECISION',
    schema_version: '0.1',
    run_id: canonicalRunId,
    article_id: article.id,
    decision,
    skip_reason: skipReason,
    attach_path: attachPath,
    create_reason: createReason,
    candidate_count: candidateCount,
    candidate_sources: blockResultCounts(br),
    candidate_capped: candidateCapped,
    best_embed: bestEmbedByEmbed !== null ? Number(bestEmbedByEmbed.toFixed(4)) : null,
    best_story_id_by_embed: bestStoryIdByEmbed,
    title_token_overlap: titleOverlaps?.legacy ?? null,
    title_token_overlap_enhanced: titleOverlaps?.enhanced ?? null
  }));

  // Update canonicalStats (separate from runStats to avoid changing existing log shape)
  if (decision === 'skipped') {
    canonicalStats.skipped++;
  } else if (decision === 'attached' && attachPath) {
    canonicalStats.attachPaths[attachPath] = (canonicalStats.attachPaths[attachPath] || 0) + 1;
  } else if (decision === 'created' && createReason) {
    canonicalStats.createReasons[createReason] = (canonicalStats.createReasons[createReason] || 0) + 1;
  }
}
```

### Step 2: Add canonicalStats Object (after helpers, before runStats) ✅ COMPLETE

Separate object to avoid changing existing RUN_SUMMARY shape:
```javascript
// TTRC-357: Separate stats object for canonical logging (doesn't touch existing runStats)
let canonicalStats = {
  skipped: 0,
  attachPaths: { normal: 0, exact_title: 0, same_run: 0, cross_run_tier_a: 0, cross_run_tier_b: 0, batch_dedup: 0 },
  createReasons: {}
};
```

### Step 3: Update resetRunState() (line ~588)

Add at end of resetRunState():
```javascript
// TTRC-357: Generate fresh run ID per run (not per-process)
canonicalRunId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
loggedArticleDecisions.clear();
canonicalStats = {
  skipped: 0,
  attachPaths: { normal: 0, exact_title: 0, same_run: 0, cross_run_tier_a: 0, cross_run_tier_b: 0, batch_dedup: 0 },
  createReasons: {}
};
```

### Step 4: Capture blockResults After generateCandidates (line ~744)

Add after `lastCandidateIds = candidates.__candidateIds || [];`:
```javascript
// TTRC-357: Capture block-level sources IMMEDIATELY (lost after array operations)
const blockResults = safeBlockResults(candidates);
const candidateCapped = candidates.length === MAX_CANDIDATES_CAP;  // Strict equality - hit the cap
```

### Step 5: Add emitArticleDecision at Each Return Point

**Pattern**: Log at EVERY `return` statement. Each article hits exactly one return.

---

**5a. Already clustered early return (line ~674)**
Before the return:
```javascript
emitArticleDecision({
  article,
  decision: 'skipped',
  skipReason: 'already_clustered'
});
return { ... };
```

---

**5b. Exact title match (line ~728)**
Before `return result;`:
```javascript
emitArticleDecision({
  article,
  decision: 'attached',
  attachPath: 'exact_title',
  candidateCount: 0,
  blockResults: null,  // Before generateCandidates
  bestStoryIdByEmbed: cachedStory.id
});
```

---

**5c. Normal attach (line ~911)**
Before `return result;`:
```javascript
// Use top-by-embedding for consistency (byEmbed[0] computed at line 701)
const topByEmbedNormal = byEmbed[0];
const titleOverlapsNormal = computeTitleTokenOverlaps(article.title, story.primary_headline || '');
emitArticleDecision({
  article,
  decision: 'attached',
  attachPath: 'normal',
  candidateCount: candidates.length,
  candidateCapped,
  blockResults,
  bestEmbedByEmbed: topByEmbedNormal?.scoreResult?.embeddingScore ?? null,
  bestStoryIdByEmbed: topByEmbedNormal?.story?.id ?? null,
  titleOverlaps: titleOverlapsNormal
});
```

---

**5d. Same-run override (line ~1005)**
Before `return overrideResult;`:
```javascript
emitArticleDecision({
  article,
  decision: 'attached',
  attachPath: 'same_run',
  candidateCount: candidates.length,
  candidateCapped,
  blockResults,
  bestEmbedByEmbed: topEmbedding,
  bestStoryIdByEmbed: overrideStory.id
});
```

---

**5e. Cross-run override Tier A/B (line ~1229)**
Before `return overrideResult;`:
```javascript
emitArticleDecision({
  article,
  decision: 'attached',
  attachPath: isTierA ? 'cross_run_tier_a' : 'cross_run_tier_b',
  candidateCount: candidates.length,
  candidateCapped,
  blockResults,
  bestEmbedByEmbed: embedBest,
  bestStoryIdByEmbed: targetStory.id,
  titleOverlaps  // Already computed at line 965
});
```

---

**5f. Batch dedup attach (line ~1466)**
Before `return batchResult;`:
```javascript
emitArticleDecision({
  article,
  decision: 'attached',
  attachPath: 'batch_dedup',
  candidateCount: candidates.length,
  candidateCapped,
  blockResults,
  bestEmbedByEmbed: sim,
  bestStoryIdByEmbed: batchStory.id
});
```

---

**5g. Create new story (line ~1566)**
Before the final `return result;`:
```javascript
// TTRC-357: Log creation - use top-by-embedding consistently
const topByEmbedCreate = allByEmbed?.[0];
const bestEmbedForLog = topByEmbedCreate?.scoreResult?.embeddingScore ?? null;
const bestStoryIdForLog = topByEmbedCreate?.story?.id ?? null;
const bestTitleOverlaps = topByEmbedCreate?.story
  ? computeTitleTokenOverlaps(article.title, topByEmbedCreate.story.primary_headline || '')
  : null;

// Only consider hybrid score when embed is Tier B eligible (avoids misclassification)
const bestEmbed = bestEmbedForLog ?? 0;
let bestTotalForReason = 0;
if (bestEmbed >= 0.88) {
  bestTotalForReason = bestMatch?.scoreResult?.total ?? 0;
}

emitArticleDecision({
  article,
  decision: 'created',
  createReason: determineCreateReason(candidates.length, bestEmbed, bestTotalForReason, threshold),
  candidateCount: candidates.length,
  candidateCapped,
  blockResults,
  bestEmbedByEmbed: bestEmbedForLog,
  bestStoryIdByEmbed: bestStoryIdForLog,
  titleOverlaps: bestTitleOverlaps
});
```

---

### Step 6: Add RUN_SUMMARY_CANONICAL (line ~1966)

After existing RUN_SUMMARY log:
```javascript
// TTRC-357: Emit canonical run summary (use canonicalStats, not runStats)
if (LOG_CANONICAL_DECISIONS) {
  console.log(JSON.stringify({
    type: 'RUN_SUMMARY_CANONICAL',
    schema_version: '0.1',
    run_id: canonicalRunId,
    articles_processed: results.processed,
    articles_attached: results.attached,
    articles_created: results.created,
    articles_skipped: canonicalStats.skipped,
    attach_paths: canonicalStats.attachPaths,
    create_reasons: canonicalStats.createReasons
  }));
}
```

---

## Files Modified

- `scripts/rss/hybrid-clustering.js`
  - Add LOG_CANONICAL_DECISIONS flag and run ID generation
  - Add helper functions: safeBlockResults, blockResultCounts, determineCreateReason, emitArticleDecision
  - Add loggedArticleDecisions Set for double-log prevention
  - Extend runStats with attachPaths and createReasons
  - Capture blockResults after generateCandidates()
  - Add emitArticleDecision at 6 return points
  - Add RUN_SUMMARY_CANONICAL emission
  - Update resetRunState() to clear logging state

---

## Dependencies

- **TTRC-355 (Stage 1)**: Uses `computeTitleTokenOverlaps()` for `title_token_overlap` fields
  - Already merged (commits `844f91d`, `fcfe886`, `7b674ca`)
  - No action needed

---

## Validation Checklist

- [ ] LOG_CANONICAL_DECISIONS defaults OFF (`=== 'true'`)
- [ ] Double-log prevention via Set (cleared in resetRunState)
- [ ] canonicalRunId generated fresh in resetRunState() + defensive guard in emitArticleDecision
- [ ] blockResults captured via safeBlockResults() at line 629
- [ ] candidateCapped uses strict equality (`=== MAX_CANDIDATES`)
- [ ] All 7 returns call emitArticleDecision (including skipped)
- [ ] create_reason uses 0.88 threshold (Tier B floor)
- [ ] bestTotalForReason only set when embed >= 0.88 (avoids misclassification)
- [ ] best_story_id_by_embed uses top-by-embedding consistently
- [ ] canonicalStats is separate object (doesn't mutate existing runStats)
- [ ] RUN_SUMMARY_CANONICAL uses canonicalStats
- [ ] Existing logs unchanged (OVERRIDE, NEAR_MISS, RUN_SUMMARY)
- [ ] No behavior changes (pure logging)

---

## Testing

**IMPORTANT**: You cannot set env vars via command line for GitHub Actions runners.

### Option 1: Temporarily modify workflow YAML
Add to `.github/workflows/rss-tracker-test.yml`:
```yaml
env:
  LOG_CANONICAL_DECISIONS: 'true'
```

### Option 2: Add workflow_dispatch input
```yaml
on:
  workflow_dispatch:
    inputs:
      log_canonical:
        description: 'Enable canonical decision logs'
        default: 'false'
        type: choice
        options: ['true', 'false']
# Then in job:
env:
  LOG_CANONICAL_DECISIONS: ${{ inputs.log_canonical }}
```

### After enabling, verify:
```bash
# Trigger run
gh workflow run "RSS Tracker - TEST" --ref test

# Verify ARTICLE_DECISION logs
gh run view <id> --log | grep '"type":"ARTICLE_DECISION"' | head -5

# Verify RUN_SUMMARY_CANONICAL
gh run view <id> --log | grep '"type":"RUN_SUMMARY_CANONICAL"'

# Check create_reasons distribution (key diagnostic)
gh run view <id> --log | grep ARTICLE_DECISION | grep '"decision":"created"' | \
  grep -oP '"create_reason":"[^"]*"' | sort | uniq -c

# Check for retrieval gaps
gh run view <id> --log | grep ARTICLE_DECISION | \
  grep '"create_reason":"no_candidates"' | head -3

# Check for capped candidates (potential lost stories)
gh run view <id> --log | grep ARTICLE_DECISION | grep '"candidate_capped":true'

# Verify no double-logs
gh run view <id> --log | grep ARTICLE_DECISION | \
  grep -oP '"article_id":"[^"]*"' | sort | uniq -d
# (should output nothing)

# Verify reconciliation: processed == attached + created + skipped
gh run view <id> --log | grep RUN_SUMMARY_CANONICAL | jq '
  .articles_processed == (.articles_attached + .articles_created + .articles_skipped)'
```

---

## Post-Implementation Analysis

Once data accumulates (24-48h), answer:

| create_reason | Diagnosis | Action |
|--------------|-----------|--------|
| `no_candidates` | Retrieval gap - candidate gen missing stories | Tune candidate blocks |
| `best_embed_below_tierb` | Embedding < 0.88, not Tier B eligible | Check if embed quality issue or unrelated content |
| `best_hybrid_below_threshold` | Embed >= 0.88 but total score insufficient | Tune hybrid scoring weights |
| `rejected_other` | Passed thresholds but blocked (guardrail/margin/corroboration) | v0.2: expand to specific reason |

**Key queries:**
```bash
# What % of creates are retrieval gaps?
grep ARTICLE_DECISION logs | grep created | \
  jq -r '.create_reason' | sort | uniq -c | sort -rn

# For retrieval gaps, which blocks had 0?
grep ARTICLE_DECISION logs | grep no_candidates | \
  jq '.candidate_sources'

# Were any candidates capped? (potential lost stories)
grep ARTICLE_DECISION logs | jq 'select(.candidate_capped == true)' | head -5

# Compare skipped vs processed
grep RUN_SUMMARY_CANONICAL logs | jq '{processed, attached, created, skipped}'
```
