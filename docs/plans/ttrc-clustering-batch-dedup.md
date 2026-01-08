# TTRC Ticket: Clustering Batch Dedup

**Status:** Ready to create in JIRA
**Priority:** High
**Type:** Story

---

## Title

Clustering Quality: Batch processing causes duplicate stories for same topic

---

## Description

### Problem

During RSS run 20380188652, 100 articles processed but only 2 attached to existing stories. Manual review found **15-17 articles that should have clustered into 5-6 stories** but created individual stories instead.

### Missed Clusters

| Topic | Articles | Result |
|-------|----------|--------|
| Epstein Files | 5 articles with nearly identical headlines | 5 separate stories |
| Venezuela/War | 4-6 related articles | Individual stories |
| Trump Media Merger | 2 identical topic articles | 2 stories |
| Kirk/Vance Endorsement | 2 articles same event | 2 stories |
| Green Card Lottery | 2 articles same announcement | 2 stories |

### Root Cause

**Batch processing race condition.** When similar articles process sequentially:

1. Article 1 (Epstein) → no match in existing stories → creates Story A
2. Article 2 (Epstein) → Story A exists but NOT in candidate pool (ANN index not updated yet)
3. Article 3 (Epstein) → same problem
4. Result: 5 separate stories instead of 1

The candidate generation queries (ANN, time block, entity block) don't find stories created milliseconds earlier in the same batch.

### Evidence

Logs show articles matching against OLD unrelated stories:
```
Best story: ID=15259, headline="Can Marco Rubio end the war in Ukraine?"
Best score: 0.487, threshold: 0.7
→ Created new story (for Epstein article)
```

---

## Proposed Solutions

### Option 1: Two-Phase Batch Clustering (Complete Solution)

**Phase 1:** Cluster against existing stories
- Articles that match (≥0.70) → attach
- Articles that don't → mark as "orphans"

**Phase 2:** Cluster orphans against EACH OTHER
- Pairwise similarity on orphan titles/embeddings
- Group similar orphans together
- Create 1 story per group (not 1 per article)

**Impact:** Would reduce Epstein 5→1, Venezuela 4→1, etc.
**Complexity:** Medium

### Option 2: Same-Batch Dedup Check (Quick Win - RECOMMENDED START)

Before creating new story, check stories created in THIS batch:
```javascript
// In hybrid-clustering.js, before creating new story:
const batchStories = storiesCreatedThisBatch.filter(s =>
  titleSimilarity(article.title, s.headline) > 0.8
);
if (batchStories.length > 0) {
  // Attach to existing batch story instead of creating new
  attachToStory(batchStories[0]);
}
```

**Impact:** Catches obvious duplicates like Epstein
**Complexity:** Low (~20 lines)

### Option 3: Title-First Fast Match

Before full hybrid scoring, quick title check:
- If title similarity > 0.85 with any candidate → auto-attach
- Bypasses full scoring for obvious matches

### Option 4: Lower Threshold

- Current: 0.70
- Proposed: 0.60-0.65
- Risk: Over-merging unrelated stories

### Option 5: Increase Title Weight

- Current: 15%
- Proposed: 25-30%

---

## Recommendation

Start with **Option 2** (same-batch dedup) for quick win, then implement **Option 1** (two-phase) for complete solution.

---

## Files to Modify

- `scripts/rss/hybrid-clustering.js` - main clustering logic
- `scripts/rss/scoring.js` - hybrid scoring weights (if adjusting)

## Related Tickets

- TTRC-319: Server-side similarity (completed 2025-12-19)
- TTRC-320: Embedding order fix (completed 2025-12-19)
- TTRC-315: Tiered guardrail (completed 2025-12-19)
