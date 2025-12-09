# TTRC-298 Backfill Continuation

**Date:** 2025-12-08
**Status:** Article backfill running, story backfill pending

---

## Current State

Article entity backfill was started:
```bash
node scripts/backfill-article-entities-inline.js all
```

**Progress when last checked:** ~385/857 (45%) at $0.04

---

## Next Session Steps

### Step 1: Verify Article Backfill Completed

```bash
# Check if any articles still need entities
node -e "
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
supabase.from('articles').select('id', { count: 'exact', head: true }).or('entities.is.null,entities.eq.[]')
  .then(({ count }) => console.log('Articles without entities:', count));
"
```

Or via Supabase MCP:
```
GET /articles?select=id&or=(entities.is.null,entities.eq.[])&limit=1
```

**Expected:** 0 articles without entities (or very few)

---

### Step 2: Create Story Entity Backfill Script

Create `scripts/backfill-story-entities.js`:

```javascript
#!/usr/bin/env node
/**
 * TTRC-298: Story Entity Backfill
 *
 * Aggregates article entities into story entity_counter/top_entities.
 * Run AFTER article entity backfill is complete.
 *
 * This is a FREE operation (no OpenAI calls) - just SQL aggregation.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('='.repeat(60));
  console.log('TTRC-298: Story Entity Backfill');
  console.log('='.repeat(60));
  console.log('');

  // Get all stories that need entity aggregation
  const { data: stories, error } = await supabase
    .from('stories')
    .select('id, primary_headline')
    .or('entity_counter.is.null,entity_counter.eq.{}')
    .order('id', { ascending: true });

  if (error) {
    console.error('Failed to fetch stories:', error.message);
    process.exit(1);
  }

  console.log(`Found ${stories.length} stories needing entity aggregation`);
  console.log('');

  let updated = 0;
  let skipped = 0;

  for (const story of stories) {
    // Get all articles for this story with their entities
    const { data: articleStories } = await supabase
      .from('article_story')
      .select('article_id, articles(entities)')
      .eq('story_id', story.id);

    if (!articleStories || articleStories.length === 0) {
      skipped++;
      continue;
    }

    // Aggregate entities across all articles
    const entityCounter = {};
    for (const as of articleStories) {
      const entities = as.articles?.entities || [];
      for (const e of entities) {
        if (e?.id) {
          entityCounter[e.id] = (entityCounter[e.id] || 0) + 1;
        }
      }
    }

    // Skip if no entities found
    if (Object.keys(entityCounter).length === 0) {
      skipped++;
      continue;
    }

    // Derive top_entities (top 8 by count)
    const topEntities = Object.entries(entityCounter)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id]) => id);

    // Update story
    const { error: updateError } = await supabase
      .from('stories')
      .update({
        entity_counter: entityCounter,
        top_entities: topEntities
      })
      .eq('id', story.id);

    if (updateError) {
      console.error(`Failed to update story ${story.id}:`, updateError.message);
    } else {
      updated++;
      process.stdout.write('.');
      if (updated % 50 === 0) {
        console.log(` [${updated}]`);
      }
    }
  }

  console.log('');
  console.log('');
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Stories updated: ${updated}`);
  console.log(`Stories skipped (no entities): ${skipped}`);
  console.log('');
  console.log('Cost: $0.00 (SQL only, no OpenAI)');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

### Step 3: Run Story Entity Backfill

```bash
node scripts/backfill-story-entities.js
```

**Expected output:**
- Updates ~2000 stories
- Takes ~1-2 minutes
- Cost: $0.00

---

### Step 4: Verify Results

```sql
-- Check stories now have entity_counter
SELECT COUNT(*) as total,
       COUNT(*) FILTER (WHERE entity_counter != '{}') as with_entities
FROM stories;

-- Sample stories with entities
SELECT id, primary_headline, top_entities
FROM stories
WHERE top_entities IS NOT NULL AND array_length(top_entities, 1) > 0
ORDER BY last_updated_at DESC
LIMIT 10;
```

---

## Summary of Full Backfill Process

| Step | Script | Cost | Status |
|------|--------|------|--------|
| 1. Article entities | `backfill-article-entities-inline.js all` | ~$0.10 | Running |
| 2. Story aggregation | `backfill-story-entities.js` | $0.00 | Pending |

---

## Files

- Article backfill: `scripts/backfill-article-entities-inline.js` (exists)
- Story backfill: `scripts/backfill-story-entities.js` (create in Step 2)
