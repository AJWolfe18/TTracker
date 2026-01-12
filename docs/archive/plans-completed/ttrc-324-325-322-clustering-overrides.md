# Implementation Plan: TTRC-324, TTRC-325, TTRC-322 Clustering Overrides

**Created:** 2025-12-20
**Status:** ✅ IMPLEMENTED
**Revised:** v4 - Final
**Commit:** 763fc4d (test branch)

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

## TTRC-324: Cross-Run High-Embedding Override (v2 - Two-Tier)

**Priority:** High | **Location:** `scripts/rss/hybrid-clustering.js`
**Status:** v1 implemented, v2 pending (slug gate too strict)

### Problem with v1
Slug gate blocks valid merges. Epstein articles have different slugs (`EPSTEIN-DOCS-RELEASE` vs `EPSTEIN-FILES-REMOVED-TRUMP`) but ARE the same event.

### v2 Design: Two-Tier Safety Profile

**Tier A** - Very high embedding, no corroboration needed:
- `embedBest >= 0.90`
- `timeDiff <= 48h`
- `margin >= 0.04` (embedBest - embedSecond)
- `passesGuardrail`

**Tier B** - High embedding, needs corroboration:
- `embedBest >= 0.88`
- `timeDiff <= 72h`
- `margin >= 0.04`
- `passesGuardrail`
- AND one of:
  - `slugTokenSimilarity.passes` (preferred)
  - `entityOverlapCount >= 1`
  - `titleTokenOverlap >= 1` (shared token length >= 5)

```javascript
// Tier A: Very high embedding
if (embedBest >= 0.90 && timeDiff <= 48h && margin >= 0.04 && passesGuardrail) {
  return attach(tier: "A");
}

// Tier B: High embedding + corroboration
if (embedBest >= 0.88 && timeDiff <= 72h && margin >= 0.04 && passesGuardrail) {
  const corroboration = slugTokenSimilarity.passes ||
                        entityOverlapCount >= 1 ||
                        titleTokenOverlap >= 1;
  if (corroboration) {
    return attach(tier: "B");
  }
}
```

### Logging
```json
{
  "type": "CROSS_RUN_OVERRIDE",
  "tier": "A",
  "embed_best": 0.91,
  "margin": 0.08,
  "corroboration": null
}
```

### Success Criteria
- Epstein-class articles attach instead of creating new stories
- No spike in obviously-wrong merges (spot-check 20 overrides first week)
- Attach rate increases materially

**Estimated Changes:** ~60 lines (refactor existing TTRC-324)

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
