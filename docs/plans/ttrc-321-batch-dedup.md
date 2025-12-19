# Clustering Improvement Plan - TTRC-321

## Executive Summary

This plan addresses the batch processing race condition causing duplicate stories for same-topic articles. The **hypothesized** issue: articles processed milliseconds apart in the same RSS run don't see each other's newly-created stories in candidate generation queries.

**New Ticket:** TTRC-321 - Clustering: Batch processing causes duplicate stories for same topic

**Status:** HYPOTHESIS UNCONFIRMED - Need diagnostic logging to prove root cause

---

## Phase 0: Confirm Root Cause (REQUIRED FIRST)

### Hypothesis

Stories created earlier in the same RSS run are NOT returned as candidates for later articles in that run.

### Diagnostic Logging Plan

#### 1. Set RUN_START globally (scope fix)

> **Note:** Phase 0 assumes `candidate-generation.js` executes in the same Node process as the entrypoint. If separate processes are spawned, pass `runStart` explicitly through the call chain instead.

In `rss-tracker-supabase.js` at start of run:
```javascript
globalThis.__RUN_START__ = new Date();
console.log(`[RUN_START] ${globalThis.__RUN_START__.toISOString()}`);
```

In `candidate-generation.js` and `hybrid-clustering.js`, use a **getter function** (not module-level const):
```javascript
// IMPORTANT: Resolve dynamically to avoid module import order issues
function getRunStart() {
  return globalThis.__RUN_START__ ?? null;
}
```

Then inside functions:
```javascript
const RUN_START = getRunStart();
```

> **Why not module-level const?** If the module is imported before `globalThis.__RUN_START__` is set, the const captures `null` forever.

**Alternative (more explicit):** Pass `runStart` through call chain:
```javascript
clusterBatch({ runStart }) → clusterArticle(article, { runStart }) → generateCandidates(article, { runStart })
```

#### 2. Add `created_at` to candidate selects (TEMPORARY for Phase 0)

> **TEMPORARY EGRESS HIT:** Adding `created_at` slightly increases data transfer. Revert after Phase 0 validation is complete.

In `candidate-generation.js`, add `created_at` to ALL select statements:
```javascript
.select('id, primary_headline, entity_counter, top_entities, topic_slugs, last_updated_at, primary_source_domain, lifecycle_state, created_at')
```

Files to modify:
- `getTimeBlockCandidates()` - line ~107
- `getEntityBlockCandidates()` - line ~146
- `getSlugBlockCandidates()` - line ~199

**Cleanup after Phase 0:** Remove `created_at` from selects and set `LOG_PHASE0_DIAGNOSTICS=false`.

#### 3. Add Phase 0 logging flag (prevents permanent spam)

In `hybrid-clustering.js` at module level:
```javascript
const LOG_PHASE0 = process.env.LOG_PHASE0_DIAGNOSTICS === 'true';
```

All Phase 0 logs should be wrapped: `if (LOG_PHASE0) { ... }`

#### 4. Log story creation with correct field names

In `hybrid-clustering.js` after `createNewStory()`:
```javascript
if (LOG_PHASE0) {
  console.log(`[STORY_CREATED] story_id=${newStory.id} primary_headline="${newStory.primary_headline}" created_at=${newStory.created_at || 'n/a'}`);
}
```

Note: Use `newStory` object fields directly, not `article.title`.

#### 5. Log candidate generation with this-run check

In `candidate-generation.js` at end of `generateCandidates()`:
```javascript
const LOG_PHASE0 = process.env.LOG_PHASE0_DIAGNOSTICS === 'true';

if (LOG_PHASE0 && RUN_START) {
  // Defensive: warn if created_at is missing (would cause false negatives)
  if (result.length > 0 && result.every(c => !c.created_at)) {
    console.warn(`[PHASE0_WARNING] created_at_missing_in_candidates=true - check selects!`);
  }

  const thisRunCandidates = result.filter(c => c.created_at && new Date(c.created_at) >= RUN_START);
  console.log(`[CANDIDATES] article_id=${article.id} from_this_run=${thisRunCandidates.length} total=${result.length}`);
}

// Attach candidate IDs as metadata (backwards-compatible, non-enumerable)
Object.defineProperty(result, '__candidateIds', {
  value: result.map(c => c.id),
  enumerable: false
});
return result;
```

**IMPORTANT:**
- Keep return as array for backwards compatibility
- Use `Object.defineProperty` with `enumerable: false` to prevent leaking into `Object.keys()` / logging
- Access IDs via `candidates.__candidateIds`

#### 5b. Per-block expected story check (pinpoints cause)

To identify which blocking method is missing the expected story, add per-block tracking:

```javascript
// In generateCandidates(), track which blocks contain each story ID
const blockResults = {
  time: timeCandidates.map(c => c.id),
  entity: entityCandidates.map(c => c.id),
  ann: annCandidates.map(c => c.id),
  slug: slugCandidates.map(c => c.id)
};

// Attach to result as non-enumerable (won't leak into Object.keys/logging)
Object.defineProperty(result, '__blockResults', {
  value: blockResults,
  enumerable: false
});
```

In `hybrid-clustering.js`, when logging `[DUP_IN_RUN]`, add:
```javascript
const blocks = candidates.__blockResults || {};
console.log(`[DUP_IN_RUN_DETAIL] time_has_expected=${blocks.time?.includes(prev.storyId)} entity_has_expected=${blocks.entity?.includes(prev.storyId)} ann_has_expected=${blocks.ann?.includes(prev.storyId)} slug_has_expected=${blocks.slug?.includes(prev.storyId)}`);
```

This instantly tells you:
- **ANN only missing** → HNSW index lag
- **All missing** → Filtering (lifecycle_state or time window)
- **Time missing** → Story's `last_updated_at` outside window

#### 6. Log decision with full context (reuse TTRC-315 merge reasons)

In `hybrid-clustering.js` before `createNewStory()`:
```javascript
if (LOG_PHASE0) {
  console.log(`[DECISION] action=create_new_story article_id=${article.id} best_story_id=${bestMatch?.story?.id || 'none'} best_total=${bestMatch?.scoreResult?.total?.toFixed(3) || 'n/a'} embedding=${bestMatch?.scoreResult?.embeddingScore?.toFixed(3) || 'n/a'} passes_guardrail=${passesGuardrail ?? 'n/a'} threshold=${threshold.toFixed(3)}`);
}
```

#### 7. SMOKING GUN: Detect duplicates AND check candidate non-visibility

In `hybrid-clustering.js` at module level:
```javascript
// Track titles seen this run for duplicate detection
// Store FIRST occurrence only - never overwrite
const seenTitlesThisRun = new Map(); // normalizedTitle -> { storyId }
let lastCandidateIds = [];  // Track candidates for current article

function normalizeTitle(title) {
  return (title || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function resetRunState() {
  seenTitlesThisRun.clear();
  lastCandidateIds = [];
}
```

Store candidate IDs after `generateCandidates()`:
```javascript
const candidates = await generateCandidates(article);
lastCandidateIds = candidates.__candidateIds || [];
```

**BEFORE** `createNewStory()` - log if we're about to create a duplicate:
```javascript
if (LOG_PHASE0) {
  const norm = normalizeTitle(article.title);
  if (seenTitlesThisRun.has(norm)) {
    // About to create duplicate - log full context before creation
    const prev = seenTitlesThisRun.get(norm);
    const expectedInCandidates = lastCandidateIds.includes(prev.storyId);
    console.warn(`[ABOUT_TO_DUP] article_id=${article.id} normalized_title="${norm}" first_seen_story=${prev.storyId} first_story_in_candidates=${expectedInCandidates} best_story_id=${bestMatch?.story?.id || 'none'} best_total=${bestMatch?.scoreResult?.total?.toFixed(3) || 'n/a'} passes_guardrail=${passesGuardrail ?? 'n/a'}`);
  }
}
```

**AFTER** `createNewStory()`:
```javascript
if (LOG_PHASE0) {
  const norm = normalizeTitle(article.title);
  if (seenTitlesThisRun.has(norm)) {
    // Confirmed duplicate - log with block-level detail
    const prev = seenTitlesThisRun.get(norm);
    const expectedInCandidates = lastCandidateIds.includes(prev.storyId);
    const blocks = candidates.__blockResults || {};
    console.warn(`[DUP_IN_RUN] article_id=${article.id} normalized_title="${norm}" created_story=${result.story_id} first_seen_story=${prev.storyId} expected_in_candidates=${expectedInCandidates} candidate_count=${lastCandidateIds.length}`);
    console.log(`[DUP_IN_RUN_DETAIL] time_has_expected=${blocks.time?.includes(prev.storyId)} entity_has_expected=${blocks.entity?.includes(prev.storyId)} ann_has_expected=${blocks.ann?.includes(prev.storyId)} slug_has_expected=${blocks.slug?.includes(prev.storyId)}`);

    // Log new story fields to check if filters explain non-visibility
    console.log(`[NEW_STORY_FIELDS] lifecycle_state=${newStory.lifecycle_state} last_updated_at=${newStory.last_updated_at} topic_slugs_count=${newStory.topic_slugs?.length || 0} top_entities_count=${newStory.top_entities?.length || 0}`);
  } else {
    // First time seeing this title - store it (never overwrite)
    seenTitlesThisRun.set(norm, { storyId: result.story_id });
  }
}
```

> **Why log `[NEW_STORY_FIELDS]`?** If `top_entities` is empty or `topic_slugs` isn't set, entity/slug blocks SHOULD miss it—that's not a race condition, just incomplete fields at creation time.

**If `expected_in_candidates=false`** → Story was NOT in candidates → Candidate non-visibility (index lag or filtering)
**If `expected_in_candidates=true`** → Story WAS in candidates → Root cause is scoring/guardrails

Call `resetRunState()` at start of RSS run in `rss-tracker-supabase.js`.

#### Concurrency Assumption

> **CRITICAL:** Phase 0 and Phase 1 assume clustering processes articles **sequentially** within a single run.
>
> If concurrency > 1 (parallel article processing), Phase 1 in-memory dedup needs:
> - Mutex/lock around `seenTitlesThisRun` access
> - OR store dedup state in database with atomic updates
> - OR queue articles and process single-threaded
>
> Current RSS tracker is single-threaded, but future changes may break this assumption.

### Expected Result If Hypothesis True (Candidate Non-Visibility)

```
[RUN_START] 2025-12-19T10:00:00.000Z
[STORY_CREATED] story_id=15300 primary_headline="Epstein files released..." created_at=2025-12-19T10:00:01.000Z
[CANDIDATES] article_id=art-xyz from_this_run=0 total=45
[DECISION] action=create_new_story article_id=art-xyz best_story_id=15100 best_total=0.520 embedding=0.450 passes_guardrail=false threshold=0.700
[STORY_CREATED] story_id=15301 primary_headline="New Epstein documents..." created_at=2025-12-19T10:00:02.000Z
[DUP_IN_RUN] article_id=art-xyz normalized_title="epstein files released" created_story=15301 first_seen_story=15300 expected_in_candidates=false candidate_count=45
[DUP_IN_RUN_DETAIL] time_has_expected=false entity_has_expected=false ann_has_expected=false slug_has_expected=false
```

**Key diagnostic: `expected_in_candidates=false`** → Story was NOT in candidates → Candidate non-visibility (index lag or filtering)

### Alternative Result If Root Cause Is Scoring/Guardrails

```
[DUP_IN_RUN] ... first_seen_story=15300 expected_in_candidates=true candidate_count=45
[DUP_IN_RUN_DETAIL] time_has_expected=true entity_has_expected=true ann_has_expected=false slug_has_expected=true
[DECISION] ... best_story_id=15300 best_total=0.650 passes_guardrail=false
```

**Key diagnostic: `expected_in_candidates=true` + `passes_guardrail=false`** → Story WAS in candidates but blocked by guardrail

### Alternative Result If Root Cause Is ANN-Only Lag

```
[DUP_IN_RUN_DETAIL] time_has_expected=true entity_has_expected=true ann_has_expected=false slug_has_expected=true
```

**Key diagnostic:** Time/entity/slug have it, only ANN missing → HNSW index lag (not critical since other blocks should find it)

### Acceptance Criteria for Hypothesis

- [ ] At least 1 `[DUP_IN_RUN]` log entry (smoking gun)
- [ ] Story X absent from candidate lists (`from_this_run=0`)
- [ ] `[DECISION]` shows why article didn't attach (score/guardrail)

### Alternative Findings

If diagnostic logging shows:
- Story X IS in candidates but score < threshold → Problem is scoring, not visibility
- Story X IS in candidates and score >= threshold but not attached → Bug in attach logic
- Candidates always include this-run stories → Hypothesis disproven, different root cause

### Key Technical Context

**Stories are committed immediately** - no batch transaction. Each `createNewStory()`:
1. `INSERT INTO stories` → commits
2. `INSERT INTO article_story` → commits
3. `initializeCentroid()` → updates centroid

**3 of 4 blocking methods use standard SQL** (no index lag):
- Time block: B-tree on `last_updated_at`
- Entity block: GIN on `top_entities`
- Slug block: GIN on `topic_slugs`

**Only ANN (HNSW) might have lag** - but it's 1 of 4 methods.

**More likely root causes:**
1. **Scoring Issue**: Story in candidates but score < 0.70
2. **Guardrail Block**: Score passes but fails TTRC-311/315 guardrails
3. **Time Window Edge Case**: Story's `last_updated_at` outside ±72h of article's `published_at`
4. **Entity Mismatch**: Story's `top_entities` doesn't overlap with later article's entities

---

## Previously Completed Work (Context)

| Ticket | Feature | Status | Impact |
|--------|---------|--------|--------|
| TTRC-302 | Topic Slug Canonicalization | COMPLETE | 100% slug coverage, reduced drift |
| TTRC-315 | Tiered Guardrail + Slug Tokens | COMPLETE | Improved semantic clustering |
| TTRC-319 | Server-Side Similarity (Egress) | COMPLETE | 204GB→1GB/month egress |
| TTRC-320 | Embedding Order Bug | COMPLETE | 100% embedding coverage |

These fixes improved clustering quality but don't address the batch race condition.

---

## Problem Statement

**Observed:** RSS run 20380188652 processed 100 articles, only 2 attached to existing stories.
**Expected:** 15-17 articles should have clustered into 5-6 stories.

### Specific Examples

| Topic | Articles Found | Actual Result | Expected |
|-------|----------------|---------------|----------|
| Epstein Files | 5 identical headlines | 5 separate stories | 1 story |
| Venezuela/War | 4-6 related | Individual stories | 1-2 stories |
| Trump Media Merger | 2 same topic | 2 stories | 1 story |
| Kirk/Vance Endorsement | 2 same event | 2 stories | 1 story |

### Hypothesized Root Causes (To Be Proven in Phase 0)

1. **ANN index lag** - HNSW index may not reflect stories created moments earlier
2. **Scoring threshold** - Story IS in candidates but score < 0.70
3. **Guardrail block** - Score passes threshold but fails TTRC-311/315 guardrails
4. **Time window edge case** - Story's `last_updated_at` outside ±72h window
5. **Entity mismatch** - Story's `top_entities` doesn't overlap with later article
6. **No in-memory tracking** - Each article processed independently without batch awareness

**Phase 0 diagnostic logging will identify which cause(s) apply via `expected_in_candidates` field in `[DUP_IN_RUN]` logs.**

---

## Implementation Plan

### Phase 1: Same-Run Dedup Safety Net

**Goal:** Prevent duplicate story creation within single RSS run
**Complexity:** Low (~30 lines)
**File:** `scripts/rss/hybrid-clustering.js`

> **Note:** Phase 1 applies regardless of whether the root cause is ANN visibility, stale candidate snapshot, scoring threshold, or guardrail filtering—it prevents same-run duplicate story creation as a safety net.

#### Implementation Steps

1. **Add batch tracking state** at module level:
   ```javascript
   // Track stories created in current batch
   let batchCreatedStories = [];

   export function resetBatchState() {
     batchCreatedStories = [];
   }
   ```

2. **Check batch stories before creating new story** in `clusterArticle()`:
   ```javascript
   // Before createNewStory(), check batch-created stories
   const batchMatch = findBatchMatch(article, batchCreatedStories);
   if (batchMatch && batchMatch.score > 0.80) {
     await attachToStory(article, batchMatch.story, batchMatch.score);
     return { action: 'attached_batch', storyId: batchMatch.story.id };
   }
   ```

3. **Track newly created stories** (store full object for attachToStory compatibility):
   ```javascript
   // After createNewStory()
   batchCreatedStories.push({
     ...newStory,  // Full story object for attachToStory()
     topic_slugs: newStory.topic_slugs || [article.topic_slug]
   });
   ```

   > **Note:** Store full `newStory` object (or minimum fields required by `attachToStory`). Storing only id/headline/topic_slugs may break aggregation logic.

4. **Add title matching helper (EXACT-ONLY for safety)**:
   ```javascript
   function findBatchMatch(article, batchStories) {
     const normArticle = normalizeTitle(article.title);

     for (const story of batchStories) {
       const normStory = normalizeTitle(story.primary_headline);

       // EXACT MATCH ONLY - prevents Phase 1 from masking scoring/candidate issues
       // This is enough to crush Epstein-style duplicates (identical headlines)
       if (normArticle === normStory) {
         return { story, score: 1.0, matchType: 'exact_title' };
       }
     }
     return null;
   }
   ```

   > **Why exact-only?** Fuzzy matching (titleSim > 0.80) could mask deeper scoring/candidate issues and accidentally merge "same-ish headlines" that aren't truly the same story. Exact match is safe and handles the Epstein case.
   >
   > **Future:** If exact-only isn't enough, add embedding similarity check via RPC (floor ≥ 0.82) before fuzzy attach.

5. **Reset batch state** at start of `clusterBatch()`:
   ```javascript
   export async function clusterBatch(limit = 50) {
     resetBatchState();
     // ... existing logic
   }
   ```

#### Acceptance Criteria
- [ ] Exact normalized title match auto-attaches (Epstein-style duplicates)
- [ ] Batch state resets between runs
- [ ] Logging shows "attached_batch" action with `matchType: 'exact_title'`
- [ ] **CRITICAL:** `attached_batch` path must call `attachToStory()` (not a custom update)
- [ ] **CRITICAL:** `attachToStory()` must update `last_updated_at` so time-block sees story later in run

> **Note:** Phase 1 is EXACT-ONLY for safety. Fuzzy matching (0.80 threshold) deferred to avoid masking deeper issues.

---

### Phase 2: Two-Phase Batch Clustering (Future - Requires Design Review)

**Goal:** Cluster orphan articles against each other after initial pass
**Complexity:** Medium-High (requires merge semantics)
**Files:** `scripts/rss/hybrid-clustering.js`, possibly new `batch-clustering.js`

> **WARNING: HIGH RISK**
> Phase 2 as written (move article links + delete story) bypasses lifecycle/audit semantics and can corrupt enrichment state.
>
> **Requirements before implementation:**
> - Story lifecycle merge semantics (`merged_into` field, audit trail)
> - Centroid recomputation parity with existing `centroid-tracking.js` logic
> - Handle enrichment state (what if source story has AI summary?)
>
> **Default Phase 2 action should be "suggest merge" (log/report), NOT auto-delete stories.**
>
> **Recommendation:** Do not implement until Phase 1 is validated and merge design is reviewed. Consider as separate ticket.

---

## Critical Files

| File | Changes |
|------|---------|
| `scripts/rss/hybrid-clustering.js` | Batch tracking, Phase 0 logging, duplicate detection |
| `scripts/rss/candidate-generation.js` | Add created_at to selects, attach __candidateIds/__blockResults |
| `scripts/rss-tracker-supabase.js` | Set globalThis.__RUN_START__, call resetRunState() |

---

## Testing Plan

1. **Unit Test:** Same-batch dedup with 5 Epstein-like headlines
2. **Integration Test:** Full RSS run with `LOG_PHASE0_DIAGNOSTICS=true`
3. **Regression Test:** Ensure existing clustering quality maintained
4. **QA Smoke:** `npm run qa:smoke` passes

---

## Recommended Order

1. **Phase 0: Diagnostic logging** - confirm root cause with `[DUP_IN_RUN]` smoking gun
2. **Phase 1: Same-run dedup safety net** - immediate impact, low risk
3. **Validate with RSS run** - confirm duplicates reduced
4. **Phase 2: Design review only** - create separate ticket if Phase 1 insufficient
5. **Monitor clustering metrics** - track multi-article story ratio

---

## Success Metrics

### Run-Based Metrics (More Reliable)

| Metric | Before (100-article run) | Target |
|--------|--------------------------|--------|
| Articles attached to existing stories | 2 | ≥10 |
| Epstein-like duplicates (5 identical) | 5 stories | 1 story |
| `[DUP_IN_RUN]` log entries | N/A (new) | 0 |
| `attached_batch` log entries | N/A (new) | ≥5 |

### Global Metrics (For Monitoring)

| Metric | Before | Target |
|--------|--------|--------|
| Multi-article story ratio | ~2% | >15% |
| Same-topic clustering | Manual | Automatic |

> **Note:** Global ratio depends on news day variability. Prefer run-based metrics for validation.
