# Handoff: TTRC-357 Complete

**Date:** 2026-01-04
**Branch:** test
**JIRA:** TTRC-357 → Done

---

## What Was Done

Added canonical clustering logs behind `LOG_CANONICAL_DECISIONS` flag:

- **ARTICLE_DECISION** - One per article with decision/attach_path/create_reason
- **RUN_SUMMARY_CANONICAL** - Aggregated stats per run

**Commits:** `2597826`, `a5e1a51`, `bd4ac1f`, `a887119`

---

## Key Files

| File | Purpose |
|------|---------|
| `scripts/rss/hybrid-clustering.js` | All logging logic |
| `.github/workflows/rss-tracker-test.yml` | `log_canonical` input added |
| `docs/guides/clustering-logic-explained.md` | **New comprehensive guide** |

---

## Validated

- Run 20687938631 with flag enabled
- 9 ARTICLE_DECISION logs emitted
- All merges verified correct (Venezuela/Maduro cluster)

---

## create_reason Values (Key Diagnostic)

| Value | Meaning |
|-------|---------|
| `no_candidates` | Retrieval gap - 4 blocks found nothing |
| `best_embed_below_tierb` | Embed < 0.88 - likely correct separation |
| `best_hybrid_below_threshold` | **Fragmentation signal** - high embed but low hybrid |
| `rejected_other` | Guardrail/margin blocked |

---

## To Enable Logging

```bash
gh workflow run "RSS Tracker - TEST" --ref test -f log_canonical=true
```

---

## Remaining Clustering Work

| Ticket | Status | Notes |
|--------|--------|-------|
| TTRC-336 | In Progress | Batch dedup shadow mode |
| TTRC-355 | Ready for Test | Title token unification |
| TTRC-323/324/325/282 | Ready for Prod | Need prod deployment |
| TTRC-356 | Backlog | Retroactive merge (needs diagnostic data first) |

---

## Next Steps

1. Let logs accumulate 24-48h
2. Analyze `create_reason` distribution
3. Prod deployment PR for Ready for Prod tickets
