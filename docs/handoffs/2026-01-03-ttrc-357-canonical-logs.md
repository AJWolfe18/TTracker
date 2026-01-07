# Handoff: TTRC-357 Canonical Clustering Logs v0.1

**Date:** 2026-01-03
**Branch:** test
**Commit:** `2597826`

---

## Summary

Added canonical versioned logs for clustering decisions behind `LOG_CANONICAL_DECISIONS` flag. Enables diagnosing story fragmentation (retrieval gap vs threshold gap).

---

## What Was Implemented

### Two New Log Types

**ARTICLE_DECISION** (one per article):
- `decision`: attached | created | skipped
- `attach_path`: normal | exact_title | same_run | cross_run_tier_a | cross_run_tier_b | batch_dedup
- `create_reason`: no_candidates | best_embed_below_tierb | best_hybrid_below_threshold | rejected_other
- `candidate_sources`: { time, entity, ann, slug } block counts
- `candidate_capped`: true if hit MAX_CANDIDATES_CAP (200)
- `best_embed` / `best_story_id_by_embed`: consistently uses top-by-embedding
- `title_token_overlap` / `title_token_overlap_enhanced`: from TTRC-355

**RUN_SUMMARY_CANONICAL** (one per run):
- Aggregates attach_paths and create_reasons counts
- Uses separate `canonicalStats` object (doesn't touch existing RUN_SUMMARY)

### Key Implementation Details

- Run ID generated fresh per-run in `resetRunState()` (not per-process)
- Double-log prevention via Set tracking logged article IDs
- `blockResults` captured immediately after `generateCandidates()` (lost after array ops)
- `candidateCapped` uses strict equality (`=== MAX_CANDIDATES_CAP`)
- `bestTotalForReason` only set when embed >= 0.88 (avoids misclassification)
- Workflow input added for opt-in testing

---

## Validation

**Workflow Run:** 20687938631 (with `log_canonical=true`)

Sample ARTICLE_DECISION log:
```json
{
  "type": "ARTICLE_DECISION",
  "schema_version": "0.1",
  "run_id": "1767502935108-a1359480417bf",
  "article_id": "art-dc392ba2-3805-4c3d-9785-a29b705c15ae",
  "decision": "attached",
  "attach_path": "cross_run_tier_a",
  "candidate_count": 152,
  "candidate_sources": {"time": 69, "entity": 77, "ann": 60, "slug": 1},
  "candidate_capped": false,
  "best_embed": 0.9643,
  "best_story_id_by_embed": 16673,
  "title_token_overlap": 3,
  "title_token_overlap_enhanced": 3
}
```

---

## Files Modified

- `scripts/rss/hybrid-clustering.js` - All canonical logging logic
- `.github/workflows/rss-tracker-test.yml` - Added `log_canonical` input
- `docs/plans/ttrc-357-canonical-logs.md` - Implementation plan

---

## Usage

### Enable Canonical Logging

**Option 1: GitHub Actions UI**
1. Go to Actions → RSS Tracker - TEST → Run workflow
2. Set "Enable canonical decision logs (TTRC-357)" to `true`

**Option 2: CLI**
```bash
gh workflow run "RSS Tracker - TEST" --ref test -f log_canonical=true
```

### Analyze Logs

```bash
# Check create_reason distribution
gh run view <id> --log | grep ARTICLE_DECISION | grep '"decision":"created"' | \
  grep -oP '"create_reason":"[^"]*"' | sort | uniq -c

# Check for retrieval gaps
gh run view <id> --log | grep '"create_reason":"no_candidates"'

# Check for capped candidates
gh run view <id> --log | grep '"candidate_capped":true'
```

---

## JIRA Update Needed

JIRA MCP auth expired. Manually update TTRC-357:
- Add comment with implementation summary
- Transition to "Ready for Test"

---

## Next Steps

1. **Let logs accumulate** (24-48h) to gather diagnostic data
2. **Analyze create_reason distribution**:
   - `no_candidates` = retrieval gap (tune candidate blocks)
   - `best_embed_below_tierb` = embedding quality issue
   - `best_hybrid_below_threshold` = scoring weights issue
   - `rejected_other` = guardrail/margin blocked (expand in v0.2)
3. **v0.2 enhancements** (if needed): Expand `rejected_other` to specific reasons
