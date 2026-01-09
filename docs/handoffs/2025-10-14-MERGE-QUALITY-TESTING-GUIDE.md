# TTRC-231 Merge Quality Testing Guide

**Created:** 2025-10-14
**Purpose:** Test merge detection with real data to validate accuracy before PROD
**Priority:** HIGH - Required before production deployment

---

## 🎯 Goal

Validate that merge detection is working correctly with real production-like data:
- **NOT catching too much** (false positives - merging distinct stories)
- **NOT catching too little** (false negatives - missing duplicates)
- **Finding the right balance** for the 0.70 similarity threshold

---

## 📊 Testing Approach

### What We're Testing

The merge detection uses **4 criteria** (ALL must pass):

1. **Time Window:** Stories within 5 days of each other
2. **Primary Actor Match:** Same actor (Trump, Biden, etc.)
3. **Entity Overlap:** 3+ shared entities (US-SENATE, US-CONGRESS, etc.)
4. **Cosine Similarity:** ≥0.70 (70% semantic similarity from embeddings)

**Key Question:** Is the 0.70 threshold catching duplicates correctly?

---

## 🚀 How to Run Quality Tests

### Quick Test (Automated)

```bash
node scripts/test-merge-quality.js
```

**What it does:**
1. Uses your existing 20 real stories as templates
2. Creates 50 test variations:
   - 10 TRUE DUPLICATES (should merge) - 1.0 similarity
   - 10 NEAR DUPLICATES (should merge) - 0.75+ similarity
   - 15 SIMILAR BUT DISTINCT (should NOT merge) - 0.50 similarity
   - 15 COMPLETELY DIFFERENT (should NOT merge) - 0.30 similarity
3. Runs merge detection
4. Shows detailed metrics report
5. Asks if you want to clean up test data

**Expected Results:**
- **Precision:** ≥90% (when we merge, we're correct)
- **Recall:** ≥85% (we catch all duplicates)
- **Accuracy:** ≥90% (overall correctness)

---

## 📋 Manual Test with Real Data

If you want more control or want to test specific scenarios:

### Step 1: Identify Real Duplicates in Your Data

```bash
# Check for stories with very similar headlines
node -e "
import('dotenv/config');
import('@supabase/supabase-js').then(({ createClient }) => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  supabase.from('stories')
    .select('id, primary_headline, primary_actor, top_entities')
    .eq('status', 'active')
    .order('last_updated_at', { ascending: false })
    .limit(50)
    .then(({ data }) => {
      console.log('Recent Stories:');
      data.forEach(s => console.log(\`\${s.id}: \${s.primary_headline}\`));
    });
});
"
```

**Look for:** Stories that are clearly the same event with different wording

### Step 2: Run Merge Detection (Dry Run)

```bash
# See what would be merged without actually merging
node scripts/test-ttrc231-manual.js merge
```

**Review output:** Check if the candidates make sense

### Step 3: Manual Validation

Create a spreadsheet with these columns:
- Story ID 1
- Story ID 2
- Headline 1
- Headline 2
- Similarity Score
- Should Merge? (Your judgment)
- Did Merge? (System decision)
- Correct? (Match or mismatch)

**Calculate:**
- **Precision** = (Correct Merges) / (All Merges)
- **Recall** = (Correct Merges) / (All Duplicates You Found)

---

## 🔍 What to Look For

### Good Signs ✅

1. **High Precision (>90%)**
   - Very few false positives
   - When it merges, it's usually correct
   - Example: "Trump indicted" + "Trump faces charges" → MERGE (correct)

2. **High Recall (>85%)**
   - Catching most duplicates
   - Not missing obvious duplicates
   - Example: Two articles about same Trump rally → MERGE (correct)

3. **Clean Audit Trail**
   - All merges have similarity scores logged
   - Can review past decisions

### Warning Signs ⚠️

1. **Low Precision (<90%)**
   - Too many false positives
   - Merging distinct stories
   - Example: "Trump rally" + "Trump lawsuit" → MERGE (incorrect!)
   - **Fix:** Increase threshold from 0.70 to 0.75 or 0.80

2. **Low Recall (<85%)**
   - Missing duplicates
   - Obvious duplicates not merging
   - Example: Two identical Reuters articles → NO MERGE (incorrect!)
   - **Fix:** Decrease threshold from 0.70 to 0.65

3. **Inconsistent Results**
   - Sometimes merges similar stories, sometimes doesn't
   - **Check:** Entity overlap, time window, primary actor mismatches

---

## 📈 Sample Test Report

```
📊 MERGE QUALITY REPORT
================================================================================

📈 OVERALL METRICS:
  Total Test Cases: 50
  Precision: 95.0% (when we merge, we're correct)
  Recall: 90.0% (we catch all duplicates)
  Accuracy: 92.0% (overall correctness)

✅ TRUE POSITIVES (Correct Merges): 18
  Examples:
    - Story 290 ↔ 324: 1.000 similarity (TRUE_DUPLICATES)
    - Story 291 ↔ 325: 0.856 similarity (NEAR_DUPLICATES)

❌ FALSE POSITIVES (Incorrect Merges): 1
  ⚠️  WARNING: These distinct stories were incorrectly merged!
    - Story 292 ↔ 326: 0.715 similarity (SIMILAR_DISTINCT)

✅ TRUE NEGATIVES (Correctly Not Merged): 29

❌ FALSE NEGATIVES (Missed Duplicates): 2
  ⚠️  WARNING: These duplicates were NOT merged!
    - Story 293 ↔ 327: 0.685 similarity (NEAR_DUPLICATES)

💡 RECOMMENDATIONS:
  ✅ Precision is excellent (low false positive rate)
  ⚠️  Recall too low! Consider decreasing threshold from 0.70 to 0.65
```

---

## 🔧 Tuning the Threshold

Based on test results, you may need to adjust:

### Current Settings (Default)
```javascript
threshold: 0.70  // 70% similarity required
entityOverlap: 3  // 3+ shared entities
timeWindow: 5     // 5 days
```

### If Too Many False Positives (Precision <90%)
```javascript
threshold: 0.75 or 0.80  // More strict
entityOverlap: 4          // More entities required
timeWindow: 3             // Shorter window
```

### If Missing Duplicates (Recall <85%)
```javascript
threshold: 0.65  // More lenient
entityOverlap: 2  // Fewer entities required
timeWindow: 7     // Longer window
```

**To change threshold:**
```javascript
// In scripts/rss/periodic-merge.js
export async function findMergeCandidates(limit = 10, threshold = 0.70) {
  // Change default from 0.70 to your desired value
}
```

---

## 📝 Real Data Testing Checklist

Before deploying to PROD, complete these steps:

- [ ] **Run automated quality test**
  ```bash
  node scripts/test-merge-quality.js
  ```

- [ ] **Review metrics:**
  - [ ] Precision ≥90%
  - [ ] Recall ≥85%
  - [ ] Accuracy ≥90%

- [ ] **Manual review of 10-20 merge candidates:**
  - [ ] Check audit trail: `SELECT * FROM story_merge_actions ORDER BY merged_at DESC LIMIT 20`
  - [ ] Verify each merge makes sense
  - [ ] Note any false positives/negatives

- [ ] **Test edge cases:**
  - [ ] Same actor, different events (should NOT merge)
  - [ ] Different actors, same event (should NOT merge)
  - [ ] Same event, 7+ days apart (should NOT merge - time window)
  - [ ] Same event, 2-3 days apart (SHOULD merge)

- [ ] **Performance test:**
  - [ ] Run on 100+ stories
  - [ ] Check processing time (<5 seconds for 100 stories)
  - [ ] Verify no database errors

- [ ] **Document findings:**
  - [ ] Note threshold adjustments needed
  - [ ] Save example false positives/negatives
  - [ ] Update recommendations

---

## 🎯 Success Criteria

**Before PROD deployment, you must achieve:**

✅ **Precision ≥90%** - Very few incorrect merges
✅ **Recall ≥85%** - Catching most duplicates
✅ **No critical bugs** - All merges complete successfully
✅ **Audit trail working** - All merges logged with metadata
✅ **Manual review confidence** - You trust the system's decisions

**If metrics are below targets:**
- Adjust threshold (see tuning guide above)
- Re-run tests
- Repeat until targets met

---

## 📊 How Similarity Scoring Works

**Cosine Similarity Explained:**

Measures the angle between two 1536-dimensional vectors (article embeddings):

```
similarity = (A · B) / (||A|| × ||B||)
```

**Score Interpretation:**
- **1.00** = Identical content (perfect duplicate)
- **0.90-0.99** = Extremely similar (very likely duplicate)
- **0.70-0.89** = Very similar (current threshold - potential duplicate)
- **0.50-0.69** = Moderately similar (related but distinct)
- **< 0.50** = Different stories

**Our test duplicates scored 1.000** because they had identical embeddings.

---

## 🛠️ Troubleshooting

### Issue: No merge candidates found

**Possible causes:**
1. Not enough stories with embeddings
   ```sql
   SELECT COUNT(*) FROM stories WHERE centroid_embedding_v1 IS NOT NULL;
   ```
   **Need:** At least 10 stories with embeddings

2. Stories too far apart in time
   **Check:** Time window is 5 days - stories must be within this window

3. Not enough entity overlap
   **Check:** Stories need 3+ shared entities

### Issue: Too many merges (low precision)

**Fix:** Increase threshold
```javascript
// In periodic-merge.js, change default:
threshold: 0.75  // was 0.70
```

### Issue: Missing duplicates (low recall)

**Fix:** Decrease threshold
```javascript
// In periodic-merge.js, change default:
threshold: 0.65  // was 0.70
```

### Issue: Test script fails

**Check:**
1. Environment variables loaded: `.env` file exists
2. Supabase credentials correct
3. At least 10 stories with embeddings in database

---

## 📁 Files & Commands Reference

### Test Scripts
- **`scripts/test-merge-quality.js`** - Automated quality testing suite
- **`scripts/test-ttrc231-manual.js merge`** - Manual merge detection test
- **`scripts/create-test-duplicates.js`** - Create individual test duplicates

### Key Files
- **`scripts/rss/periodic-merge.js`** - Merge detection logic (lines 74-118)
- **`migrations/025_story_merge_audit.sql`** - Audit table schema
- **`migrations/027_add_merged_into_status.sql`** - Status constraint

### Useful Queries

**Check recent merges:**
```sql
SELECT
  id,
  source_story_id,
  target_story_id,
  coherence_score,
  articles_moved,
  merged_at,
  reason
FROM story_merge_actions
ORDER BY merged_at DESC
LIMIT 20;
```

**Find potential duplicates manually:**
```sql
SELECT
  s1.id AS story1_id,
  s2.id AS story2_id,
  s1.primary_headline AS headline1,
  s2.primary_headline AS headline2,
  s1.primary_actor
FROM stories s1
JOIN stories s2 ON s1.primary_actor = s2.primary_actor
WHERE s1.id < s2.id
  AND s1.status = 'active'
  AND s2.status = 'active'
  AND s1.centroid_embedding_v1 IS NOT NULL
  AND s2.centroid_embedding_v1 IS NOT NULL
LIMIT 50;
```

---

## 🚀 Next Steps

**Tomorrow's workflow:**

1. **Run quality test:** `node scripts/test-merge-quality.js`
2. **Review results:** Check precision/recall metrics
3. **Adjust threshold if needed:** Edit `periodic-merge.js`
4. **Re-test:** Verify improvements
5. **Document findings:** Note any edge cases discovered
6. **Decide:** Ready for PROD or needs more tuning?

---

## ⚠️ Important Notes

- **Cost:** $0 (uses existing embeddings, no API calls)
- **Test data:** Can be cleaned up after testing
- **Real data:** Use actual production stories for most accurate results
- **Threshold:** 0.70 is a starting point - adjust based on YOUR data
- **Safety:** All tests run in TEST environment, PROD untouched

---

## 📞 Questions to Answer Tomorrow

1. **Is 0.70 threshold catching the right duplicates?**
   - Look at precision/recall metrics
   - Review false positives/negatives manually

2. **Are there edge cases we're missing?**
   - Same actor, different events?
   - Different sources, same story?
   - Time window issues?

3. **Do we trust this enough for PROD?**
   - Would you be comfortable with automatic merging?
   - Or do we need manual review first?

4. **What threshold gives best results?**
   - Test 0.65, 0.70, 0.75, 0.80
   - Compare precision/recall tradeoffs

---

**Last Updated:** 2025-10-14
**Status:** Ready for testing
**Next Session:** Run quality tests and analyze results
