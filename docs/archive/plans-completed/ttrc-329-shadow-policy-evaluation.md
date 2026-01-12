# TTRC-329: Shadow Policy Evaluation for Tier B Threshold

**Created:** 2025-12-21
**Status:** Planning
**Branch:** test
**Parent:** TTRC-225 (Story Clustering)

---

## Problem Statement

Current clustering has fragmentation issues - related articles creating separate stories instead of merging. Initial analysis suggested lowering Tier B threshold from 0.90 to 0.88, but:

1. **Sampling bias**: We analyzed obvious fragmentation cases, not edge cases where lower thresholds could cause bad merges
2. **Timing mismatch**: Clustering runs pre-enrichment, but we analyzed post-enrichment data
3. **Entity unreliability**: NEAR_MISS logs showed `entity: false` at clustering time even when stories later shared entities

**We cannot validate thresholds using post-enrichment data.** We need in-run evaluation using the exact same candidate set + story state at decision time.

---

## Solution: Shadow Policy Diff Logging

Add parallel threshold evaluation without changing behavior. Log only when shadow policy would ATTACH but live policy would CREATE (the incremental merge set).

### What We're Testing

| Threshold | Description |
|-----------|-------------|
| 0.86 | Aggressive - likely too low |
| 0.87 | Moderate-aggressive |
| 0.88 | Moderate - initial hypothesis |
| 0.89 | Conservative |
| 0.90 | Current Tier A (baseline) |

### Corroboration Strength Ranking

| Rank | Signal | Reliability | Threshold Benefit |
|------|--------|-------------|-------------------|
| 1 | `slug_token` | Strongest | Can use lower threshold |
| 2 | `entity_overlap` | Strong (if entities exist at clustering time) | Can use lower threshold |
| 3 | `title_token` | Weakest (generic titles risk) | Requires embed >= 0.90 |

### Safety Rule

**If corroboration is `title_token` ONLY, require embed >= 0.90** to prevent generic-title gluing (e.g., "Trump responds to criticism" matching unrelated stories).

---

## Implementation Plan

### Phase 1: Shadow Policy Diff Logging (No Behavior Change)

**File:** `scripts/rss/hybrid-clustering.js`

Add logging when an article creates a new story, but would have attached under proposed thresholds:

```javascript
// After deciding to CREATE new story, add shadow evaluation
if (decision === 'create') {
  const shadowThresholds = [0.86, 0.87, 0.88, 0.89];
  const shadowResults = {};

  // Corroboration check
  const hasStrongCorroboration = slugTok.passes || entityOverlap >= 1;
  const hasTitleOnlyCorroboration = titleTokenOverlap >= 1 && !hasStrongCorroboration;

  for (const thresh of shadowThresholds) {
    // Title-only requires embed >= 0.90 (safety rule)
    const effectiveThresh = hasTitleOnlyCorroboration ? Math.max(thresh, 0.90) : thresh;
    const wouldAttach = (
      embedBest >= effectiveThresh &&
      timeDiffHours <= 48 &&
      passesGuardrail &&
      (hasStrongCorroboration || hasTitleOnlyCorroboration)
    );
    shadowResults[`tierB_${thresh}`] = wouldAttach;
  }

  // Only log if at least one shadow would attach
  if (Object.values(shadowResults).some(v => v)) {
    console.log(JSON.stringify({
      type: 'SHADOW_POLICY_DIFF',
      article_id: article.id,
      article_title: article.title?.substring(0, 80),
      best_candidate_id: targetStory?.id,
      best_candidate_headline: targetStory?.primary_headline?.substring(0, 80),
      embed_best: embedBest,
      embed_second: embedSecond,
      margin: margin,
      candidate_count: candidates.length,
      time_diff_hours: timeDiffHours,
      guardrail: passesGuardrail,
      corroboration_type: hasStrongCorroboration ? (slugTok.passes ? 'slug' : 'entity') : (hasTitleOnlyCorroboration ? 'title_only' : 'none'),
      corroboration_detail: {
        entity: entityOverlap,
        slug: slugTok.passes,
        title: titleTokenOverlap
      },
      // Entity snapshots at clustering time (key diagnostic)
      article_entities_count: article.entities?.length || 0,
      story_entities_count: targetStory?.top_entities?.length || 0,
      article_entity_sample: (article.entities || []).slice(0, 5).map(e => e.id || e.name || e),
      story_entity_sample: (targetStory?.top_entities || []).slice(0, 5),
      // Shadow results
      shadow_results: shadowResults
    }));
  }
}
```

### Phase 2: Data Collection (2-3 Days)

Run RSS workflow normally. Collect SHADOW_POLICY_DIFF logs.

**Expected output per log:**
- Which thresholds would have triggered merge
- Corroboration type used
- Entity availability at clustering time
- Article and candidate headlines for manual review

### Phase 3: Targeted Manual Review

Sample 30-60 "riskiest" cases from shadow-diff set:

| Risk Factor | Why Risky |
|-------------|-----------|
| Lowest embed that would attach | Most aggressive threshold |
| Lowest margin | Most ambiguous candidate selection |
| Title-only corroboration | Generic titles can match unrelated |
| Longest time_diff near cutoff | More time = more chance of different events |
| High candidate_count + close embed_second | Ambiguous best match |

**Labeling Categories:**
- `SAME_EVENT` - Correct merge (OK)
- `SAME_SAGA_DIFFERENT_EVENT` - Product decision (related but distinct)
- `DIFFERENT_EVENT` - False positive (bad merge)

### Phase 4: Threshold Selection

**Decision criteria:**
- Select the **highest** Tier B threshold that fixes meaningful fragmentation
- Target: **<= 1 false positive per 100 auto-merges**
- If FP rate too high at 0.88, try 0.89
- If FP rate acceptable at 0.87, consider that

### Phase 5: Ship Chosen Threshold

**Implementation:**
```javascript
// Tier B with corroboration
const hasStrongCorroboration = slugTok.passes || entityOverlap >= 1;
const hasTitleOnlyCorroboration = titleTokenOverlap >= 1 && !hasStrongCorroboration;

// Safety rule: title-only requires embed >= 0.90
const tierBThreshold = hasTitleOnlyCorroboration ? 0.90 : CHOSEN_THRESHOLD; // e.g., 0.88

const passesTierB = (
  embedBest >= tierBThreshold &&
  timeDiffHours <= 48 &&
  passesGuardrail &&
  (hasStrongCorroboration || hasTitleOnlyCorroboration)
);
```

### Phase 6: Post-Ship Monitoring

Keep shadow-diff logging enabled for 24-48h after shipping as regression safety net.

---

## Success Criteria

- [ ] Shadow policy diff logging implemented
- [ ] Entity snapshot fields added to logs
- [ ] 2-3 days of data collected
- [ ] 30-60 riskiest cases manually labeled
- [ ] FP rate calculated per threshold
- [ ] Threshold selected based on data (not gut)
- [ ] Safety rule implemented (title-only → embed >= 0.90)
- [ ] Post-ship monitoring confirms no regression

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Shadow logging adds latency | Minimal - just JSON stringify + console.log |
| Manual review is subjective | Use clear labeling criteria, sample riskiest cases |
| Chosen threshold still has FPs | Keep shadow logging post-ship, can revert quickly |
| Entity data unreliable | Entity snapshots prove/disprove reliability before relying on it |

---

## Files to Modify

| File | Changes |
|------|---------|
| `scripts/rss/hybrid-clustering.js` | Add SHADOW_POLICY_DIFF logging after create decisions |

---

## Future Considerations

1. **Entity seeding**: If entity snapshots show low availability, consider seeding story entities immediately at attach time
2. **72h time window**: If data shows many blocks due to 48h cutoff with strong corroboration, consider conditional 72h for Tier B
3. **Two-phase clustering**: If entity reliability remains low, consider fast initial clustering + periodic consolidation pass

---

## Related Tickets

- TTRC-324: Two-tier cross-run override (current implementation)
- TTRC-328: Evaluate recency filters for entity/slug candidate blocks
- TTRC-225: Story Clustering (parent epic)
