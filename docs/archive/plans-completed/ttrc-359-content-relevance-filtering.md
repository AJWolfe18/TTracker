# TTRC-359: Content Relevance Filtering - Options Analysis

**Date:** 2026-01-04
**Status:** Planning
**Ticket:** TTRC-359

---

## Quick Win: Fix Vox Feed (Do First)

**Problem:** Vox is using full site RSS (`vox.com/rss/index.xml`) which includes tech, culture, health, etc.

**Fix:** Switch to politics-only feed.

| Feed | Status | Size |
|------|--------|------|
| `rss/index.xml` (current) | Active | Full site junk |
| `rss/policy-and-politics/index.xml` | **DEAD** | Empty |
| `rss/politics/index.xml` | **ACTIVE** | 250KB, real politics |

**Action:**
```sql
UPDATE feed_registry
SET feed_url = 'https://www.vox.com/rss/politics/index.xml'
WHERE source_name = 'Vox';
```

**Impact:** Eliminates ~30-50% of junk articles with zero code changes.

**After this fix:** Run 1-2 RSS cycles and reassess if TTRC-359 code changes are still needed.

---

## Problem Statement (Remaining After Vox Fix)

~10% of ingested articles are irrelevant to Trump accountability tracking:
- Obituaries ("Asad Haider dies at 38")
- State/local politics ("California open-carry ban")
- Tech explainers ("How to kill a rogue AI")
- Listicles ("26 things we think will happen")
- Entertainment tangents ("Clooney reacts...")

**Scale:** 179 articles since Jan 1, 2026. ~18 irrelevant = wasted embedding/clustering/enrichment.

**Current System:** `scorer.js` uses keyword scoring:
- Federal keywords (DOJ, Congress, etc.) = +2
- Trump keywords (trump, maga, mar-a-lago) = +2
- Local blocks (city council, mayor) = -2
- Keep if score >= 1

**Gap:** Articles pass with just "federal" + politics URL path, no Trump connection.

---

## The Core Design Question

> "Should we require Trump keywords, or treat executive agencies as implicitly Trump-relevant?"

### The Constitutional Insight (Key Framing)

| Branch | Relationship to Trump | Default Relevance |
|--------|----------------------|-------------------|
| **Executive** (DOJ, ICE, DHS, FBI, CBP, EPA, etc.) | Trump controls these agencies | **Implicitly relevant** |
| **Legislative** (Congress, Senate, House) | Separate branch | Only if Trump involved |
| **Judicial** (Federal courts, judges) | Independent | Only if Trump involved |

This means:
- "DOJ announces policy" → KEEP (Trump's DOJ)
- "ICE deports 500" → KEEP (Trump's ICE)
- "Congress debates bill" → FILTER (unless Trump signing/vetoing)
- "Federal judge blocks order" → NUANCED (see below)

### The Court Edge Case

"Judge blocks deportations" should be KEPT even without "Trump" in title because:
- It's blocking a Trump admin action
- Courts + exec agency reference = relevant

**Solution:** Contextual branch + exec indicator → keep

---

## Options Stack Rank (Best to Worst ROI)

### TIER 1: RECOMMENDED

#### Option A: Soft Gate + 2-Layer Filter

**Architecture:**
```
Layer A: High-precision drops (obvious junk)
  └── URL path denylists (/obituaries/, /travel/, /arts/)
  └── Title patterns (obituary, dies at, crossword, recipe)

Layer B: Hard keeps (exec branch signals)
  └── Executive agencies (DOJ, ICE, DHS, FBI, CBP, etc.)
  └── Trump/admin signals (trump, cabinet names, DOGE, tariff)
  └── Contextual + exec tie + action verb → keep

Gate behavior: Mark is_relevant=false, skip downstream processing
```

**Why this is best ROI:**
1. **Zero false negatives** - articles still stored, can reprocess
2. **Cuts 90% of waste** where it matters (embeddings = $, clustering = compute)
3. **Simple to implement** - one boolean + reason string
4. **Easy iteration** - shadow mode first, then flip
5. **Recoverable** - if filter is wrong, batch-update `is_relevant=true`

**Implementation:**
- Add `is_relevant BOOLEAN DEFAULT true` to articles table
- Add `relevance_gate TEXT` for logging (e.g., "drop_path", "no_signals")
- In fetch_feed.js: set `is_relevant=false` instead of skipping insert
- In clustering: `WHERE is_relevant = true`
- In enrichment: `WHERE is_relevant = true`

**Cost:** Zero (deterministic)
**Risk:** Very low (soft gate = reversible)

---

### TIER 2: GOOD ALTERNATIVE

#### Option B: 2-Layer Deterministic Hard Filter

Same logic as Option A, but hard-drop at ingestion instead of soft gate.

**Pros:**
- Cleaner DB (no irrelevant records)
- Slightly simpler (no new column)

**Cons:**
- False negatives are unrecoverable
- Need higher confidence in filter accuracy

**When to use:** After 1-2 weeks of clean soft-gate logs proving filter accuracy.

---

### TIER 3: NOT RECOMMENDED

#### Option C: REQUIRE_TRUMP Everywhere

Add gate: if no Trump keyword in title → filter

**Fatal flaw:** Drops "DOJ does X" / "ICE does Y" which ARE Trump admin actions.
**False negative risk:** HIGH
**Do not implement.**

---

### TIER 4: OVERKILL

#### Option D: AI Relevance Scoring

GPT-4o-mini call per article: "Is this Trump-related? Yes/No"

**Cost:** ~$0.002/article × 50/day = $3/month
**Complexity:** High (prompt engineering, latency, API errors)
**Accuracy:** Higher than keywords, but...

**Not worth it because:**
- 10% problem doesn't justify AI complexity
- Deterministic filter catches 90%+ of junk
- Can add AI later for edge cases if needed

---

## Recommended Implementation (Option A Details)

### Regex Buckets

```javascript
// Layer A: High-precision drops
const DROP_PATH_RX = [
  /\/obituar(y|ies)\b/i,
  /\/travel\b/i,
  /\/arts?\b/i,
  /\/style\b/i,
  /\/food\b/i,
  /\/recipes?\b/i,
  /\/technology\b/i,
  /\/sports?\b/i,
  /\/games\b/i,
];

const DROP_TITLE_RX = [
  /\bobituary\b/i,
  /\bdies at \d+\b/i,
  /\bcrossword\b/i,
  /\bwordle\b/i,
  /\brecipe\b/i,
  /\breview:/i,
  /\bwhat to watch\b/i,
  /\b(best|top) \d+ (things|ways|tips)\b/i,
];

// Layer B: Hard keeps (exec branch)
const EXEC_AGENCY_RX = /\b(doj|justice department|department of justice|ice|immigration and customs|dhs|homeland security|cbp|customs and border protection|fbi|atf|dea|secret service|state department|treasury|pentagon|department of defense|dod|hhs|va|epa|sec|ftc|fcc)\b/i;

const TRUMP_ADMIN_RX = /\b(trump|donald trump|white house|oval office|mar-a-lago|executive order)\b/i;

const CABINET_RX = /\b(rubio|vance|noem|bondi|patel|hegseth|musk|lutnick|bessent)\b/i;

const DOGE_TOPICS_RX = /\b(doge|deportation|tariff|greenland|panama canal|maduro|venezuela)\b/i;

// Contextual (needs exec tie)
const CONTEXTUAL_FED_RX = /\b(congress|senate|house|supreme court|scotus|federal judge|federal court|circuit court|appeals court)\b/i;

// Action verbs (helps contextual pass)
const GOV_ACTION_RX = /\b(blocks?|orders?|sues?|appeals?|indicts?|charges?|deports?|detains?|raids?|sanctions?|implements?|announces?|enforces?|rolls back|expands?|halts?|rescinds?)\b/i;
```

### Gate Logic

```javascript
function checkRelevance({ title, url }) {
  // Layer A: obvious junk
  if (DROP_PATH_RX.some(rx => rx.test(url))) {
    return { relevant: false, gate: 'drop_path' };
  }
  if (DROP_TITLE_RX.some(rx => rx.test(title))) {
    return { relevant: false, gate: 'drop_title' };
  }

  // Layer B: hard keep
  const hasExec = EXEC_AGENCY_RX.test(title);
  const hasTrump = TRUMP_ADMIN_RX.test(title);
  const hasCabinet = CABINET_RX.test(title);
  const hasDogeTopics = DOGE_TOPICS_RX.test(title);

  if (hasExec || hasTrump || hasCabinet || hasDogeTopics) {
    return { relevant: true, gate: 'exec_keep' };
  }

  // Contextual: only if exec tie + action
  const isContextual = CONTEXTUAL_FED_RX.test(title);
  const hasAction = GOV_ACTION_RX.test(title);
  const hasExecTie = /\b(administration|agency|department)\b/i.test(title);

  if (isContextual && hasAction && hasExecTie) {
    return { relevant: true, gate: 'contextual_exec_tie' };
  }

  // Default: no signals = filter
  return { relevant: false, gate: 'no_signals' };
}
```

### Rollout Plan

1. **Shadow mode (1-2 RSS runs)**
   - Log `{relevant: false, gate}` but still process
   - Review what WOULD be filtered

2. **Check false positives**
   - Grep logs for `gate: 'no_signals'`
   - Verify no Trump-relevant articles dropped

3. **Flip to soft gate**
   - Add `is_relevant` column to articles
   - Set `is_relevant=false` for filtered articles
   - Update clustering/enrichment to skip irrelevant

4. **Monitor 1 week**
   - If clean, consider hard drop

---

## Files to Modify

| File | Change |
|------|--------|
| `scripts/rss/scorer.js` | Add EXEC_AGENCY_RX, DROP_PATH/TITLE_RX, checkRelevance() |
| `scripts/rss/fetch_feed.js` | Call checkRelevance(), set is_relevant |
| `migrations/028_add_is_relevant.sql` | Add is_relevant column (if soft gate) |
| `.github/workflows/rss-tracker-test.yml` | Add RELEVANCE_GATE_SHADOW flag |

---

## Decision Points for Discussion

1. **Soft gate vs hard drop?**
   - Recommend: Start with soft gate (is_relevant=false)
   - Revisit hard drop after 1 week of clean logs

2. **Include "White House" and "administration" in exec bucket?**
   - Risk: "White House holiday decor" passes
   - Mitigation: Require action verb when only signal is WH/admin

3. **Cabinet name list - how many?**
   - Current: rubio, vance, noem, bondi, patel, hegseth, musk, lutnick, bessent
   - Too many = maintenance burden, too few = misses

4. **Shadow mode duration?**
   - Recommend: 2-3 RSS runs, review ~50 would-filter articles

---

## Summary

| Option | ROI | Risk | Recommendation |
|--------|-----|------|----------------|
| Soft Gate + 2-Layer | Highest | Lowest | **DO THIS** |
| Hard Drop + 2-Layer | High | Low | After validation |
| REQUIRE_TRUMP | Low | High | Don't do |
| AI Scoring | Medium | Medium | Overkill for 10% problem |

**Next step:** Confirm soft gate approach, then implement shadow mode.
