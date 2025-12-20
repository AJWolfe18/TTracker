# Implementation Plan: TTRC-324, TTRC-325, TTRC-322 Clustering Overrides

**Created:** 2025-12-20
**Status:** Approved
**Revised:** v4 - Final

---

## Overview

Three clustering improvements to reduce duplicate story creation:
1. **TTRC-324:** Same-run exact title match dedup (HIGH)
2. **TTRC-325:** Cross-run slug + embedding override (HIGH)
3. **TTRC-322:** Seed entity_counter with primary_actor (MEDIUM)

---

## TTRC-324: Same-Run Exact Title Match Dedup

**Priority:** High | **Location:** `scripts/rss/hybrid-clustering.js`

**Infrastructure:** Already exists (`seenTitlesThisRun` Map at line 38, `resetRunState()` at lines 63-67)

### Implementation

1. Add `normalizeTitle(title)` function:
   - lowercase, replace non-alphanum with spaces, collapse whitespace, trim

2. **Check EARLY** - At START of `clusterArticle()`, before candidate generation:
   ```javascript
   const normTitle = normalizeTitle(article.title);

   // Guard: skip generic short titles
   if (normTitle.length < 20) {
     // proceed to normal clustering
   }

   // Check for exact match
   if (seenTitlesThisRun.has(normTitle)) {
     const cachedStory = seenTitlesThisRun.get(normTitle);

     // SLUG SANITY CHECK: if article has slug and story has slugs, require match
     const articleSlug = article.topic_slug;
     const storyHasSlugs = cachedStory.topic_slugs?.length > 0;
     const slugsMatch = !articleSlug || !storyHasSlugs ||
                        cachedStory.topic_slugs.includes(articleSlug);

     if (!slugsMatch) {
       // Different events with same headline - proceed to normal clustering
     } else {
       // Log and attach
       console.log(JSON.stringify({
         type: 'EXACT_TITLE_DEDUP_ATTACH',
         article_id: article.id,
         target_story_id: cachedStory.id,
         normalized_title: normTitle
       }));
       return attachToStory(article, cachedStory, 1.0);
     }
   }
   ```

3. **Never overwrite first-seen mapping** - After `createNewStory()`:
   ```javascript
   // Only store if NOT already present (first story wins)
   if (!seenTitlesThisRun.has(normTitle)) {
     seenTitlesThisRun.set(normTitle, story);  // Full object
   }
   ```

4. **Store full story object** (not just storyId) - prevents go-back if `attachToStory()` needs more fields

**Concurrency Note:** In-memory map is NOT concurrency-safe. Current clustering is sequential, so fine.

**Estimated Changes:** ~50 lines

---

## TTRC-325: Cross-Run Slug + Embedding Attach Override

**Priority:** High | **Location:** `scripts/rss/hybrid-clustering.js` (in "would create new story" branch, after TTRC-321 check)

### Critical Design: Candidate Selection

The key insight: "bestMatch" by total score is wrong because total is suppressed. Instead:

```javascript
// ============================================================================
// TTRC-325: Cross-Run Slug + Embedding Override
// Run ONLY when about to create new story (after normal attach failed)
// ============================================================================

// Step 1: Filter candidates to those passing gates
const slugTimeFilteredCandidates = scoredCandidates.filter(c => {
  const story = c.story;
  const scoreResult = c.scoreResult;

  // Slug gate (exact OR token-based)
  const hasExactSlug = story.topic_slugs?.includes(article.topic_slug);
  const slugTok = slugTokenSimilarity(article.topic_slug, story.topic_slugs);
  const slugGate = hasExactSlug || slugTok.passes;
  if (!slugGate) return false;

  // Time gate (72h from last activity) - DEFENSIVE: missing timestamps = false
  const articleTime = article.published_at ? new Date(article.published_at).getTime() : NaN;
  const storyTime = story.last_updated_at ? new Date(story.last_updated_at).getTime() : NaN;
  if (!Number.isFinite(articleTime) || !Number.isFinite(storyTime)) return false;

  const timeDiffMs = Math.abs(articleTime - storyTime);
  const timeGate = timeDiffMs <= 72 * 60 * 60 * 1000;
  if (!timeGate) return false;

  // Guardrail check
  const passesGuardrail = passesClusteringGuardrail(article, story, scoreResult);
  if (!passesGuardrail) return false;

  return true;
});

// Step 2: From filtered set, pick highest embeddingScore
if (slugTimeFilteredCandidates.length > 0) {
  const byEmbed = [...slugTimeFilteredCandidates].sort(
    (a, b) => (b.scoreResult?.embeddingScore ?? 0) - (a.scoreResult?.embeddingScore ?? 0)
  );

  const bestSlugCandidate = byEmbed[0];
  const embedBest = bestSlugCandidate.scoreResult?.embeddingScore ?? 0;
  const embedSecond = byEmbed[1]?.scoreResult?.embeddingScore ?? 0;

  // Threshold check (start at 0.80 since gates are strict, tune upward if false positives)
  if (embedBest >= 0.80) {
    const targetStory = bestSlugCandidate.story;
    const hasExactSlug = targetStory.topic_slugs?.includes(article.topic_slug);
    const timeDiffMs = Math.abs(
      new Date(article.published_at) - new Date(targetStory.last_updated_at)
    );

    console.log(JSON.stringify({
      type: 'SLUG_EMBED_OVERRIDE',
      article_id: article.id,
      story_id: targetStory.id,
      embed_best: embedBest.toFixed(3),
      embed_second: embedSecond.toFixed(3),
      total: bestSlugCandidate.scoreResult?.total?.toFixed(3),
      threshold: GUARDRAIL.FINAL_THRESHOLD,
      slug_gate: hasExactSlug ? 'exact' : 'token',
      timeWindowMinutes: Math.round(timeDiffMs / 60000),
      candidate_count_slug_time: slugTimeFilteredCandidates.length
    }));

    return attachToStory(article, targetStory, bestSlugCandidate.scoreResult.total);
  }
}

// Fall through to createNewStory()
```

### Pre-Implementation Verification
- [ ] Confirm `attachToStory()` unions `topic_slugs` (not replaces)
- [ ] Confirm `attachToStory()` updates `last_updated_at`
- If either is false, add that behavior as part of TTRC-325

### Threshold Strategy
- Start at **0.80** since gates are strict (slug + time + guardrail)
- Tune upward only if false positives observed
- Optional: LOG_ONLY mode first run to observe actual embedding scores

**Estimated Changes:** ~60 lines

---

## TTRC-322: Seed Minimal Story Entities at Creation

**Priority:** Medium | **Location:** `scripts/rss/hybrid-clustering.js` lines 631-637

**Scope: primary_actor ONLY** (no article.entities iteration)

```javascript
const entityCounter = {};
const topEntities = [];

// Seed with primary_actor if available and non-empty (TTRC-322)
const actor = article.primary_actor?.trim();
if (actor) {
  entityCounter[actor] = 1;
  topEntities.push(actor);
}

// Note: NOT iterating article.entities - that's enrichment's job
```

**Why primary_actor only:**
- Zero cost
- Low risk of polluting with junk
- Entity extraction moved to enrichment - don't duplicate
- Expand scope in follow-up ticket if needed

**Estimated Changes:** ~8 lines

---

## Run-Level Counters (Cheap Observability)

Add end-of-run summary in `clusterBatch()`:

```javascript
console.log(JSON.stringify({
  type: 'RUN_SUMMARY',
  created: stats.created,
  attached_normal: stats.attachedNormal,
  attached_321_same_run: stats.attached321,
  attached_325_slug_embed: stats.attached325,
  attached_324_exact_title: stats.attached324
}));
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| TTRC-324: No-overwrite | First story wins, prevents ping-pong |
| TTRC-324: Slug sanity check | Prevents merging different events with same headline |
| TTRC-325: Filter-then-pick | "Best total" is wrong when total is suppressed |
| TTRC-325: 0.80 threshold | Gates are strict (slug+time+guardrail), tune upward if false positives |
| TTRC-322: primary_actor only | Minimal, zero cost, expand later if needed |
| Run counters | Cheap observability, not a dashboard |

---

## Implementation Order

1. TTRC-324 (simplest, lowest risk)
2. TTRC-325 (fixes Epstein-class failures)
3. TTRC-322 (follow-up improvement)
