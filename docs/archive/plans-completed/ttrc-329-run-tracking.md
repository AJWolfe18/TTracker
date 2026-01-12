# TTRC-329: Shadow Policy Run Tracking

**Purpose:** Track clustering behavior across RSS runs to inform threshold tuning decisions.

**Goal:** Collect 20+ data points showing cases where articles *almost* merged but didn't, to understand if we're being too strict or too loose.

---

## Run Log

### Run 1: 2025-12-24 18:37 UTC (run 20491979093)

**Stats:**
- Articles processed: 31
- New stories created: 25
- Attached to existing: 6 (1 normal, 5 slug-match)
- Near-misses logged: 11

**Near-Miss Breakdown:**

| Blocker | Count | Notes |
|---------|-------|-------|
| Time (>48h) | 7 | Stories 5-35 days old - correctly blocked |
| Margin | 4 | Close competition with second-best match |

**False Negatives Found (should have merged but didn't):**

| Article | Best Match Story | Embed | Time | Blocker | Outcome |
|---------|------------------|-------|------|---------|---------|
| art-184fe6a6 | 16338 | 0.887 | 3h | margin | Created story 16347 (duplicate!) |
| art-b446fe3d | 16338 | 0.898 | 2.5h | margin + no corroboration | Created story 16359 (duplicate!) |

**Fragmentation Example:**
Three separate stories about the same event (Trump banning EU officials):
- Story 16338: "Trump administration bars 5 prominent Europeans..."
- Story 16347: "U.S. bars five Europeans it says pressured tech firms..."
- Story 16359: "They Seek to Curb Online Hate. The U.S. Accuses Them..."

**Key Insight:** Margin gate blocking legitimate merges at high embed scores (0.887-0.898).

---

### Run 2: 2025-12-26 17:45 UTC (run 20526749990)

**Stats:**
- Articles processed: 58
- New stories created: 46
- Attached to existing: 12 (2 normal, 10 slug-match)
- Near-misses logged: 17
- **Shadow policy diffs: 2** (first real diffs from live RSS!)

**Shadow Policy Diffs (would have merged at lower threshold):**

| Article | Title | Best Story | Embed | Corroboration | Would merge at |
|---------|-------|------------|-------|---------------|----------------|
| art-08f5659c | "Judge Blocks Detention of British Researcher..." | 16367 (UK campaigner vs Trump) | 0.883 | entity (UK-AHMED) | 0.86, 0.87, 0.88 |
| art-0055537a | "Trump news: EU could respond to 'unjustified' US visa bans" | 16338 (EU officials banned) | 0.881 | entity (US-TRUMP, ORG-EU) | 0.86, 0.87, 0.88 |

**Key Insight:** Both diffs are in the 0.88-0.89 range with entity corroboration. These would correctly merge if threshold was 0.88 (current) but they're being blocked by something else (likely margin).

---

## Cumulative Findings

### Near-Miss Distribution (updated each run)

| Blocker Type | Total Count | % of Near-Misses |
|--------------|-------------|------------------|
| Time (>48h) | ~15 | ~54% |
| Margin | ~10 | ~36% |
| Embed (<0.88) | ~3 | ~10% |
| Guardrail | 0 | 0% |

### False Negative Rate

| Run Date | Near-Misses | False Negatives | Rate |
|----------|-------------|-----------------|------|
| 2025-12-24 | 11 | 2 | 18% |
| 2025-12-26 | 17 | 2+ (TBD) | ~12% |
| **Total** | **28** | **4+** | **~14%** |

### Shadow Policy Diffs (embed 0.86-0.88 with corroboration)

| Run Date | Shadow Diffs | Notes |
|----------|--------------|-------|
| 2025-12-24 | 0 | Most near-misses have title-only corroboration (requires 0.90) |
| Fresh sim (200 articles) | 1 | Melania/Putin article, embed=0.863, entity corroboration |
| 2025-12-26 | 2 | UK-Ahmed researcher + EU visa ban stories |
| **Total** | **3** | Need 20+ for threshold analysis |

---

## Decision Criteria

**When to make a decision:**
- [ ] 20+ shadow policy diffs collected (currently: 3)
- [ ] 5+ runs tracked (currently: 2)
- [ ] Pattern emerges in false negative causes

**Current hypothesis:**
The embed threshold (0.88) may not be the main issue. The **margin gate** appears to be the primary blocker for legitimate merges.

---

## Next Steps

1. Continue collecting data from RSS runs
2. After 5+ runs, analyze:
   - Is margin gate too strict?
   - Should margin be relaxed when corroboration exists?
   - Is the 0.88 embed threshold appropriate?

---

*Last updated: 2025-12-26*
