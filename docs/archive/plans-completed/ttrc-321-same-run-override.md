# TTRC-321: Same-Run High-Embedding Override

**Status:** Ready for Implementation
**Priority:** High
**Created:** 2025-12-19

---

## Problem Statement

Phase 0 diagnostics revealed that same-run stories ARE being found via ANN (embedding similarity 0.90+), BUT the hybrid scoring doesn't reach the 0.700 threshold because:

- **Entity overlap = 0** (newborn stories have empty `entity_counter`/`top_entities`)
- **Title similarity low** (different headlines for same topic)

Result: Duplicate stories created for Epstein (6+), Stefanik (3), Bongino (4+), etc.

## Solution: Safe High-Embedding Attach Override

Add a targeted override that attaches to same-run stories when embedding is very high and at least one safety gate passes.

**Key principle:** Keep hybrid scoring as-is. Only bypass the final threshold, not the whole safety system.

---

## Implementation Spec

### Override Triggers When ALL:

```javascript
const story = bestMatch.story;
const isHighEmbed = precomputedSimilarity >= 0.90;
const isSameRun = new Date(story.created_at) >= runStart;
const belowThreshold = bestScore.total < GUARDRAIL.FINAL_THRESHOLD;
const passesGuardrail = bestScore.passesGuardrail; // Keep existing safety checks!

// Must pass ALL of: highEmbed, sameRun, belowThreshold, passesGuardrail
```

### AND at least ONE safety gate:

```javascript
// 1. Margin: clear winner over second-best
const hasMargin = (bestEmbedding - secondBestEmbedding) >= 0.04;

// 2. Slug overlap: reuse existing slugTokenSimilarity() logic
// IMPORTANT: Use slugs, not titles!
const slugTok = slugTokenSimilarity(article.topic_slug, story.topic_slugs);
const hasSlugOverlap = slugTok.passes;

// 3. Time window: published within 2 hours of story creation
const articlePubTime = new Date(article.published_at).getTime();
const storyCreateTime = new Date(story.created_at).getTime();
const hasTightWindow = Math.abs(articlePubTime - storyCreateTime) < 2 * 60 * 60 * 1000;

const safetyGatePasses = hasMargin || hasSlugOverlap || hasTightWindow;
```

### Full Override Condition:

```javascript
const shouldOverride =
  isHighEmbed &&
  isSameRun &&
  belowThreshold &&
  passesGuardrail &&
  safetyGatePasses;

if (shouldOverride) {
  // Log and attach instead of creating new story
}
```

---

## Pre-Implementation Checklist

### 1. Ensure `created_at` exists on all candidate sources

| Source | File | Action Required |
|--------|------|-----------------|
| Time block | candidate-generation.js | Verify `created_at` in SELECT |
| Entity block | candidate-generation.js | Verify `created_at` in SELECT |
| ANN RPC | find_similar_stories | Add `created_at` to RETURNS TABLE |
| Slug block | candidate-generation.js | Verify `created_at` in SELECT |

**Note:** Phase 0 already added `created_at` to selects (TEMPORARY). Need to verify ANN RPC.

### 2. Track secondBestEmbedding

Currently only track best match. Need to modify scoring loop to track top 2.

### 3. Use correct slugTokenSimilarity() signature

```javascript
// WRONG (uses titles):
slugTokenSimilarity(article.title, bestMatch.primary_headline)

// CORRECT (uses slugs):
slugTokenSimilarity(article.topic_slug, story.topic_slugs)
```

### 4. Consistent bestMatch shape

Use `bestMatch.story.<fields>` pattern throughout:
```javascript
const story = bestMatch.story;
const isSameRun = new Date(story.created_at) >= runStart;
const hasSlugOverlap = slugTokenSimilarity(article.topic_slug, story.topic_slugs).passes;
```

---

## Logging Spec

Log when override triggers with ALL gates that passed:

```javascript
const reasons = [];
if (hasMargin) reasons.push('margin');
if (hasSlugOverlap) reasons.push('slug');
if (hasTightWindow) reasons.push('time');

console.log(JSON.stringify({
  type: 'SAME_RUN_OVERRIDE',
  article_id: article.id,
  story_id: story.id,
  embeddingSim: precomputedSimilarity,
  secondBestEmbedding: secondBestEmbedding,
  total: bestScore.total,
  threshold: GUARDRAIL.FINAL_THRESHOLD,
  isSameRun: true,
  reasonsPassed: reasons,  // All gates that passed
  // Debug fields:
  margin: bestEmbedding - secondBestEmbedding,
  slugPasses: hasSlugOverlap,
  timeWindowMinutes: Math.round(Math.abs(articlePubTime - storyCreateTime) / 1000 / 60)
}));
```

---

## Thresholds (v1 - Conservative)

| Parameter | Value | Notes |
|-----------|-------|-------|
| Embedding threshold | 0.90 | Start conservative, can lower to 0.88 if false negatives |
| Margin threshold | 0.04 | Clear winner over second-best |
| Slug overlap | .passes | Reuse existing boolean, no new threshold |
| Time window | 2 hours | Covers breaking news cadence |

---

## Validation Plan

1. Run 1-2 test RSS workflows with override enabled
2. Sample ~50 override merges
3. Manual review for false positives
4. Adjust thresholds if needed (0.88-0.92 range)

---

## Files to Modify

| File | Changes |
|------|---------|
| `scripts/rss/hybrid-clustering.js` | Add override logic, track secondBest |
| `scripts/rss/candidate-generation.js` | Verify created_at in all selects |
| `scripts/rss/scoring.js` | May need to expose passesGuardrail |
| `supabase/migrations/` or RPC | Verify find_similar_stories returns created_at |

---

## Expected Outcome

- Kills same-run duplicate story spam (Epstein/Stefanik/Bongino cases)
- Minimal regression risk (multiple safety gates)
- Instrumented for validation

---

## Follow-up Tickets (Not Blocking)

- **TTRC-322:** Seed entity_counter with primary_actor at story creation
- **TTRC-323:** Weight renormalization when entities are missing
- **Cleanup:** Remove Phase 0 diagnostic logging after validation
