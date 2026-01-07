# TTRC-315 Validation & New Bugs Found

**Date:** 2025-12-19
**Status:** TTRC-315 validated, two new bugs discovered
**Branch:** test

---

## Session Summary

| Task | Result |
|------|--------|
| TTRC-315 AI review fixes | ✅ Verified (commit 877c119) |
| TTRC-315 code implementation | ✅ Correct and deployed |
| RSS workflow status | ✅ Was disabled, re-enabled and ran |
| Clustering quality | ✅ Working as designed (4.8% attachment rate) |
| Egress root cause | 🐛 Found - TTRC-319 created |
| Embedding order bug | 🐛 Found - TTRC-320 created |

---

## TTRC-315: Tiered Guardrail - VALIDATED

### Code Review
- Commit 877c119 fixed AI review findings:
  - Removed ES stripping rule (HOUSES → HOUS bug)
  - Added SAY to STOP_TOKENS
- Implementation in `scoring.js` and `hybrid-clustering.js` is correct
- Feature flag (`ENABLE_TIERED_GUARDRAIL`) works for rollback

### Why Multi-Article Rate is Still Low
The tiered guardrail helps articles with 0.85+ embedding similarity. But most article-story pairs score 0.50-0.65, below the base 0.70 threshold. The guardrail can't help if the base threshold isn't met first.

Historical 4.8% attachment rate is consistent - not a regression.

---

## Bug #1: Egress (TTRC-319)

### Problem
Candidate generation queries fetch `centroid_embedding_v1` (6KB each) unnecessarily.

### Impact
- ~52GB/month egress vs 5GB free tier
- Current usage: 19GB

### Root Cause
All candidate blocks (time, entity, slug, ANN) return full centroid vectors to JS for similarity calculation.

### Correct Fix (Thin Client, Fat RPC)
1. ANN RPC: Return `similarity` only, drop centroid
2. Time/Entity/Slug: Calculate similarity server-side via pgvector
3. JS: Use pre-calculated similarity, never fetch centroids

**DO NOT** use 0 for embedding score - that would neuter non-ANN blocks.

### Files
- `scripts/rss/candidate-generation.js` (lines 105, 143, 195)
- `migrations/024_include_stale_in_candidate_generation.sql`
- `scripts/rss/scoring.js`

---

## Bug #2: Embedding Order (TTRC-320) - CRITICAL

### Problem
`enrichArticles()` orders by `created_at ASC` (oldest first) with limit 100. When backlog exists, new articles get skipped.

### Impact
- 54% of articles from latest run got no embeddings
- Articles without embeddings can't cluster
- PBS, Politico, Guardian systematically excluded (processed last)
- 30-40 missed clustering opportunities per run

### Evidence (RSS Run 2025-12-19)
| Source | Articles | Got Embeddings |
|--------|----------|----------------|
| WaPo | 30 | 30 (100%) |
| NYT | 19 | 15 (79%) |
| PBS | 19 | 0 (0%) |
| Politico | 15 | 0 (0%) |
| Guardian | 14 | 0 (0%) |

### Fix
Change line ~207 in `scripts/rss-tracker-supabase.js`:
```javascript
// FROM:
.order('created_at', { ascending: true })

// TO:
.order('created_at', { ascending: false })
```

Or prioritize current-run articles before backlog.

---

## Actions Taken

1. Re-enabled `rss-tracker-test.yml` workflow (was disabled)
2. Triggered RSS run, monitored completion
3. Analyzed 125 articles from run
4. Created TTRC-319 (egress fix)
5. Created TTRC-320 (embedding order bug)

---

## Priority Recommendation

1. **TTRC-320 (embedding order)** - CRITICAL, blocks clustering entirely
2. **TTRC-319 (egress)** - HIGH, costs money but doesn't block functionality

---

## Files Referenced

- `scripts/rss-tracker-supabase.js` - embedding bug location
- `scripts/rss/candidate-generation.js` - egress hotspot
- `scripts/rss/scoring.js` - TTRC-315 implementation
- `scripts/rss/hybrid-clustering.js` - guardrail logic
- `migrations/024_include_stale_in_candidate_generation.sql` - ANN RPC

---

## Atlassian MCP Notes

Plugin was slow/timing out during session. Required `/mcp` reconnection to restore functionality. May be transient or related to Claude Code update.
