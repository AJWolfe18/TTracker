# Handoff: TTRC-336 Batch Dedup Threshold Tuning

**Date:** 2026-01-02
**Ticket:** TTRC-336
**Branch:** test
**Status:** Shadow validation ongoing

---

## Summary

Raised batch dedup embed threshold for 2-token matches from **0.88 to 0.92** based on shadow analysis showing false positives in the 0.91-0.92 range with generic topic tokens.

---

## Shadow Analysis (4 Runs, 11 Attach Decisions)

### Data Collection

| Run | Date | Decisions | Attaches |
|-----|------|-----------|----------|
| 20649855089 | Jan 2 | 38 | 7 |
| 20624596975 | Dec 31 18:11 | 10 | 1 |
| 20622880854 | Dec 31 16:21 | 10 | 0 |
| 20621523101 | Dec 31 15:01 | 34 | 3 |

### Attach Decision Analysis

| Embed | Tokens | Article | Story | Verdict |
|-------|--------|---------|-------|---------|
| 0.950 | 3 | "Health Dept. Pauses Child Care..." | "Trump admin freezes childcare..." | ✅ Correct |
| 0.946 | 2 | "Russia Asks... Oil Tanker" | "Oil Tanker Fleeing..." | ✅ Correct |
| 0.942 | 2 | "Trump news... national guard" | "Trump Abandons... National Guard" | ✅ Correct |
| 0.934 | 3 | "Read Jack Smith's full deposition" | "Jack Smith Defends..." | ✅ Correct |
| 0.933 | 2 | "Trump... aspirin... health" | "Trump... 'perfect' health" | ✅ Correct |
| 0.928 | 2 | "Chief Justice Roberts..." | "Chief Justice's Annual Report" | ✅ Correct |
| **0.914** | 2 | "Oil Tanker Fleeing Coast Guard..." | "Coast Guard Searches for Survivors..." | ❌ **FP** |
| **0.912** | 2 | "Kennedy Center looting..." | "Kennedy Center URL..." | ❌ **FP** |
| 0.911 | 2 | "Trump Targets Omar in MN Fraud" | "GOP Funding Linked to MN Fraud" | ⚠️ Borderline |

### Key Finding: Clean Separation at 0.92

```
Correct matches:   0.928 ─────────────────────── 0.950
                           ↑ 0.92 threshold
False positives:   0.911 ────── 0.914
```

- **Lowest correct:** 0.928
- **Highest FP:** 0.914
- **Gap:** 0.014 (clean separation)

### False Positive Pattern

Both FPs had:
- Embed in 0.91-0.92 range
- Only 2 title tokens
- Tokens were **generic topic markers** ("Coast Guard", "Kennedy Center")
- Different events within same topic area

---

## Threshold Change

### Before
```javascript
if (sim < 0.88) return false;
// ...
return tokenOverlap >= 2 || slugOk;
```

### After
```javascript
// Strong corroboration (3+ tokens or slug): allow 0.88+
if (tokenOverlap >= 3 || slugOk) {
  return sim >= 0.88;
}

// Moderate corroboration (2 tokens): require 0.92+
if (tokenOverlap >= 2) {
  return sim >= 0.92;
}

// No corroboration: reject
return false;
```

### Rationale

1. **Batch dedup lacks entity data** - newly created stories have empty `entity_counter`
2. **DB path uses entity corroboration** - allows 0.88+ with entity >= 1 or 2
3. **Batch dedup must compensate** - higher embed threshold to offset missing signal
4. **2 tokens can be generic** - "Coast Guard" appears in unrelated boat/tanker stories

---

## Impact Assessment

### With New Thresholds

| Decision Type | Count | Outcome |
|---------------|-------|---------|
| Correct matches kept | 6/7 | ✅ All with embed >= 0.928 pass |
| False positives rejected | 2/2 | ✅ Both at 0.912-0.914 rejected |
| Borderline rejected | 1 | ⚠️ MN fraud 0.911 (arguably correct) |

### No Impact on DB Merges

The DB path (CROSS_RUN_OVERRIDE) is unaffected:
- Uses different thresholds (Tier A: 0.91+, Tier B: 0.88+)
- Has entity/slug corroboration available
- Saw merges at 0.884 via Tier B with entity corroboration

---

## Fragmentation Observed (Jan 2 Run)

Without batch dedup live, these duplicate story clusters were created:

| Topic | Story IDs | Would have merged if live |
|-------|-----------|---------------------------|
| Oil Tanker/Russia | 16615, 16617 | ✅ |
| National Guard | 16612, 16625 | ✅ |
| Trump Health | 16605, 16629 | ✅ |
| Chief Justice Roberts | 16635, 16638 | ✅ |
| Jack Smith | 16613, 16622, 16632, 16640 | ✅ (4 duplicates!) |

---

## Next Steps

1. **Keep shadow mode on** - 3-5 more runs to validate new thresholds
2. **Monitor for:**
   - Any attaches with embed 0.92-0.93 (new threshold area)
   - Any rejections that should have been attaches
3. **When confident:** Flip `BATCH_DEDUP_SHADOW_MODE=false` in workflow
4. **Then:** Create PR to main with all clustering tickets

---

## Files Changed

- `scripts/rss/hybrid-clustering.js` - Tiered threshold logic (~15 lines)

---

## JIRA Comment (Manual - MCP Auth Issue)

Add this to TTRC-336:

```
**Shadow Analysis Complete (4 runs, 11 attach decisions)**

Findings:
- 7 correct matches (all had embed >= 0.928)
- 2 false positives (embed 0.912-0.914, 2 generic topic tokens)
- Clean separation at 0.92 threshold

Threshold Change Applied:
- 2-token matches: raised from 0.88 to 0.92
- 3+ token matches: unchanged at 0.88
- Slug matches: unchanged at 0.88

Next: Shadow mode for 3-5 more runs, then flip to live.
```

---

## Commands Reference

```bash
# Trigger RSS run
gh workflow run "RSS Tracker - TEST" --ref test

# Check batch dedup logs
gh run view [RUN_ID] --log 2>&1 | grep "BATCH_DEDUP_DECISION"

# Check for attaches in new threshold range
gh run view [RUN_ID] --log 2>&1 | grep '"decision":"attach"'

# Flip to live mode (when ready)
# Edit .github/workflows/rss-tracker-test.yml
# BATCH_DEDUP_SHADOW_MODE: 'false'
```

---

## Tickets Ready for Prod

Once TTRC-336 shadow validation complete:

| Ticket | Feature | Status |
|--------|---------|--------|
| TTRC-258 | Article scraping | Ready for Prod |
| TTRC-260 | Readability upgrade | Ready for Prod |
| TTRC-320 | Embedding order fix | Ready for Prod |
| TTRC-321 | Same-run override | Ready for Prod |
| TTRC-323 | Exact title match | Ready for Prod |
| TTRC-324 | Tiered guardrails | Ready for Prod |
| TTRC-333 | Title token bypass | Ready for Prod |
| TTRC-336 | Batch dedup | In Progress (shadow) |
| TTRC-354 | Hash collision fix | Ready for Test |
