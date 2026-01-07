# TTRC-329: Recluster Single-Article Stories for Shadow Data

**Goal:** Generate shadow policy diffs by reclustering single-article stories

**Created:** 2025-12-24
**Status:** Ready to execute

---

## Background

- 913 stories have only 1 article (created during earlier recluster)
- Shadow logging wasn't enabled then, so we missed near-miss data
- Need ~20+ shadow diffs for threshold analysis
- Currently have only 3

---

## Plan

### Step 1: Create backup of current state
```bash
# Export current article_story assignments
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const fs = require('fs');
(async () => {
  const { data } = await supabase.from('article_story').select('*');
  fs.writeFileSync('logs/article_story_backup.json', JSON.stringify(data, null, 2));
  console.log('Backed up', data.length, 'assignments');
})();
"
```

### Step 2: Get single-article story IDs
```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const fs = require('fs');
(async () => {
  const { data } = await supabase.from('article_story').select('story_id, article_id');
  const counts = {};
  const articleMap = {};
  data.forEach(r => {
    counts[r.story_id] = (counts[r.story_id] || 0) + 1;
    if (!articleMap[r.story_id]) articleMap[r.story_id] = [];
    articleMap[r.story_id].push(r.article_id);
  });

  const singleArticleStories = Object.entries(counts)
    .filter(([id, count]) => count === 1)
    .map(([id]) => ({ story_id: Number(id), article_id: articleMap[id][0] }));

  fs.writeFileSync('logs/single_article_stories.json', JSON.stringify(singleArticleStories, null, 2));
  console.log('Found', singleArticleStories.length, 'single-article stories');
})();
"
```

### Step 3: Remove article_story entries for single-article stories (batch of 200)
```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const fs = require('fs');
(async () => {
  const stories = JSON.parse(fs.readFileSync('logs/single_article_stories.json'));
  const batch = stories.slice(0, 200); // First 200 only

  const articleIds = batch.map(s => s.article_id);

  const { error } = await supabase
    .from('article_story')
    .delete()
    .in('article_id', articleIds);

  if (error) console.error('Error:', error);
  else console.log('Removed', articleIds.length, 'article_story entries');

  fs.writeFileSync('logs/recluster_batch.json', JSON.stringify(articleIds, null, 2));
})();
"
```

### Step 4: Recluster the orphaned articles
```bash
# This runs the clustering with shadow logging enabled
node -e "
const { clusterArticle } = require('./scripts/rss/hybrid-clustering.js');
const fs = require('fs');
(async () => {
  const articleIds = JSON.parse(fs.readFileSync('logs/recluster_batch.json'));
  console.log('Reclustering', articleIds.length, 'articles...');

  let success = 0, failed = 0;
  for (const id of articleIds) {
    try {
      await clusterArticle(id);
      success++;
      if (success % 20 === 0) console.log('Progress:', success, '/', articleIds.length);
    } catch (e) {
      console.error('Failed:', id, e.message);
      failed++;
    }
  }
  console.log('Done. Success:', success, 'Failed:', failed);
})();
"
```

### Step 5: Collect shadow diffs from console output
The recluster will print SHADOW_POLICY_DIFF JSON lines to console.
Save the output to a log file:
```bash
node scripts/recluster-shadow-batch.js 2>&1 | tee logs/shadow-policy/recluster-run.log
```

### Step 6: Analyze the shadow data
```bash
# Pull the data into the analysis
node scripts/analyze-shadow-policy.mjs

# This creates logs/shadow-policy/risky-cases.csv
# Open in Excel, fill 'label' column (S/A/D), save as risky-cases-labeled.csv

# Generate report
node scripts/shadow-policy-report.mjs
```

---

## Script to Create (Step 4 as standalone file)

Create `scripts/recluster-shadow-batch.js`:
```javascript
import { clusterArticle } from './rss/hybrid-clustering.js';
import fs from 'fs';

const articleIds = JSON.parse(fs.readFileSync('logs/recluster_batch.json'));
console.log('Reclustering', articleIds.length, 'articles with shadow logging...');

let success = 0, failed = 0;
for (const id of articleIds) {
  try {
    await clusterArticle(id);
    success++;
    if (success % 20 === 0) console.log('Progress:', success, '/', articleIds.length);
  } catch (e) {
    console.error('Failed:', id, e.message);
    failed++;
  }
}
console.log('Done. Success:', success, 'Failed:', failed);
```

---

## What to do if context runs out

1. Read this file: `docs/plans/ttrc-329-recluster-for-shadow-data.md`
2. Check which step was last completed (look in `logs/` folder)
3. Continue from next step
4. After Step 6: label the CSV and run the report

---

## Expected Output

- ~200 articles reclustered
- Some will attach to existing stories (good matches)
- Some will create new stories (no good match)
- The "gray zone" cases will generate SHADOW_POLICY_DIFF logs
- Goal: 20-50 shadow diffs for analysis

---

## Rollback (if needed)

```bash
# Restore original article_story assignments
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const fs = require('fs');
(async () => {
  const backup = JSON.parse(fs.readFileSync('logs/article_story_backup.json'));
  const { error } = await supabase.from('article_story').upsert(backup);
  if (error) console.error('Error:', error);
  else console.log('Restored', backup.length, 'assignments');
})();
"
```
