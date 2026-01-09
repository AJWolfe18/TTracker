# TTRC-306: Topic Slug Extraction - Implementation Plan

**Date:** 2025-12-10
**Status:** Ready for Implementation (Revised after expert review)
**Branch:** test
**Estimated Effort:** 3-4 hours
**Cost:** ~$1.40 one-time + $0.45/month

---

## Summary

Implement AI-generated topic slugs to improve clustering recall without sacrificing precision. Topic slugs identify the specific news event (e.g., `HEGSETH-CONFIRMATION-HEARING`) rather than just semantic similarity.

**User Decisions:**
- ✅ Proceed with Topic Slugs (TTRC-306)
- ✅ Backfill all 1,830 existing articles (~$0.92)
- ✅ Create detailed plan, update JIRA, update docs

---

## ⚠️ Key Design Decisions (After Expert Review)

These decisions protect the precision gains from TTRC-301:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Slug bypass guardrail?** | **NO** | Slug becomes one of the "reasons to cluster" WITHIN guardrail, not a backdoor |
| **Slug bonus** | 0.08 (start) | Conservative start; tune up based on data (not 0.15) |
| **Guardrail structure** | Single check | `passesGuardrail = hasDecentEmbedding && (slugsMatch \|\| entityOverlap \|\| titleMatch)` |
| **LLM output handling** | Normalize aggressively | `normalizeSlug()` cleans output before validation |
| **Content fields** | `scraped_content \|\| excerpt` | Consistent across extraction and backfill |
| **Idempotence** | Skip if `topic_slug` set | Prevents double-charging on reprocessing |

**Critical invariant maintained:** Embedding >= 0.60 is ALWAYS required (guardrail never bypassed)

---

## Phase 1: Schema Changes (15 min)

### Migration File: `migrations/XXX_add_topic_slug.sql`

```sql
-- Add topic_slug to articles (individual article's extracted slug)
ALTER TABLE articles
ADD COLUMN IF NOT EXISTS topic_slug VARCHAR(100);

-- Add topic_slugs array to stories (aggregated from all articles)
-- NOT NULL + explicit cast ensures consistent behavior in code
ALTER TABLE stories
ADD COLUMN IF NOT EXISTS topic_slugs TEXT[] NOT NULL DEFAULT '{}'::text[];

-- Create GIN index for fast slug-based candidate generation
CREATE INDEX IF NOT EXISTS idx_stories_topic_slugs_gin
ON stories USING GIN (topic_slugs);

-- Create index on articles.topic_slug for filtering
CREATE INDEX IF NOT EXISTS idx_articles_topic_slug
ON articles (topic_slug)
WHERE topic_slug IS NOT NULL;
```

**Schema notes:**
- `topic_slugs` uses `NOT NULL DEFAULT '{}'::text[]` - explicit cast avoids "unknown" type ambiguity
- Articles can have `NULL` topic_slug (extraction failed), but stories always have an array (maybe empty)

---

## Phase 2: Slug Extraction Function (45 min)

### File: `scripts/rss/topic-extraction.js` (NEW)

```javascript
/**
 * TTRC-306: Topic Slug Extraction
 *
 * Uses GPT-4o-mini to generate canonical topic slugs for clustering.
 * Cost: ~$0.0005 per article
 *
 * IMPORTANT: Slugs are normalized aggressively to ensure consistency.
 * The LLM output is NOT trusted directly - it's cleaned and validated.
 */

import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SLUG_PROMPT = `Generate a canonical topic slug for this news article.

Rules:
1. Use ALL-CAPS with hyphens (e.g., HEGSETH-CONFIRMATION-HEARING)
2. 2-5 words maximum
3. Identify the SPECIFIC EVENT, not general topics
4. Different articles about the same event should get IDENTICAL slugs
5. Focus on: WHO-did-WHAT or WHAT-happened-WHERE

Examples:
- "Trump fires FBI director Wray" → TRUMP-FIRES-WRAY
- "Wray resignation after Trump pressure" → TRUMP-FIRES-WRAY
- "Senate confirms Hegseth as Defense Secretary" → HEGSETH-CONFIRMATION
- "Hegseth faces opposition in committee vote" → HEGSETH-CONFIRMATION
- "New Epstein documents released by FBI" → EPSTEIN-FILES-RELEASE
- "Gaza ceasefire deal reached" → GAZA-CEASEFIRE-DEAL
- "Trump's Tylenol advice and health policy" → TRUMP-TYLENOL-ADVICE
- "Government shutdown averted by funding bill" → GOVT-SHUTDOWN-AVERTED

For general opinion/analysis pieces without a specific event, use the primary topic:
- "Analysis: Trump's foreign policy shift" → TRUMP-FOREIGN-POLICY-ANALYSIS

Return ONLY the slug, nothing else.`;

/**
 * Normalize slug to consistent format
 * - Uppercase
 * - Replace non-alphanumeric with hyphens
 * - Collapse multiple hyphens
 * - Trim leading/trailing hyphens
 */
function normalizeSlug(raw) {
  if (!raw) return null;
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')  // non-alnum → hyphen
    .replace(/-+/g, '-')          // collapse consecutive hyphens
    .replace(/^-|-$/g, '');       // trim leading/trailing hyphens
}

/**
 * Extract topic slug for an article
 * Uses title + scraped_content (or excerpt as fallback)
 * @param {string} title - Article title
 * @param {string} scrapedContent - Scraped article content (preferred)
 * @param {string} excerpt - RSS excerpt (fallback)
 * @returns {string|null} - Normalized slug or null
 */
export async function extractTopicSlug(title, scrapedContent = '', excerpt = '') {
  if (!title) return null;

  // Prefer scraped_content, fall back to excerpt
  const contentSnippet = (scrapedContent || excerpt || '').slice(0, 500);
  const inputContent = `Title: ${title}\nExcerpt: ${contentSnippet}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SLUG_PROMPT },
        { role: 'user', content: inputContent }
      ],
      max_tokens: 50,
      temperature: 0.0  // Zero temp for maximum consistency
    });

    const rawSlug = response.choices[0]?.message?.content?.trim();
    const normalizedSlug = normalizeSlug(rawSlug);

    // Validate normalized slug format (3-60 chars, uppercase alphanumeric + hyphens)
    if (!normalizedSlug || !normalizedSlug.match(/^[A-Z0-9-]{3,60}$/)) {
      console.warn(`[topic-extraction] Invalid slug: raw="${rawSlug}" normalized="${normalizedSlug}" title="${title}"`);
      return null;
    }

    return normalizedSlug;
  } catch (error) {
    console.error(`[topic-extraction] Error extracting slug:`, error.message);
    return null;
  }
}

export async function extractTopicSlugBatch(articles, batchSize = 10) {
  const results = [];

  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize);
    // Use scraped_content || excerpt consistently
    const promises = batch.map(a => extractTopicSlug(
      a.title,
      a.scraped_content || '',
      a.excerpt || ''
    ));
    const slugs = await Promise.all(promises);

    results.push(...slugs);

    // Rate limit: 10 per batch with 500ms delay
    if (i + batchSize < articles.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return results;
}
```

---

## Phase 3: Integration with Enrichment Pipeline (30 min)

### File: `scripts/job-queue-worker.js`

Add slug extraction during article processing:

```javascript
// Near line 150-200 (in processArticle or enrichment function)

import { extractTopicSlug } from './rss/topic-extraction.js';

// IMPORTANT: Only extract if not already set (idempotence)
// This prevents double-charging if article is reprocessed
if (!article.topic_slug) {
  // Use scraped_content || excerpt, not generic "content"
  const scrapedContent = article.scraped_content || '';
  const excerpt = article.excerpt || '';

  const topicSlug = await extractTopicSlug(article.title, scrapedContent, excerpt);

  if (topicSlug) {
    await supabase
      .from('articles')
      .update({ topic_slug: topicSlug })
      .eq('id', article.id);

    console.log(`[job-queue-worker] Extracted topic slug: ${topicSlug} for article ${article.id}`);
  }
}
```

**Key points:**
- Skip if `topic_slug` already populated (idempotence)
- Use `scraped_content` (preferred) or `excerpt` (fallback) - not generic "content"
- Use existing OpenAI client instance if available in the worker

---

## Phase 4: Clustering Integration (45 min) ⚠️ CRITICAL

**IMPORTANT:** Slug match does NOT bypass the guardrail. It becomes one of the "reasons to cluster" WITHIN the guardrail, alongside entity overlap and title match.

### File: `scripts/rss/scoring.js`

Add slug match bonus (conservative start):

```javascript
// Near line 52-56 (BONUSES section)
const BONUSES = {
  sharedArtifacts: 0.06,
  quoteMatch: 0.05,
  sameOutlet: 0.04,
  topicSlugMatch: 0.08,  // NEW: Start conservative, tune up based on data
};
```

**Note:** Starting at 0.08 (not 0.15) to be conservative. Can tune up after seeing slug match quality in practice.

### File: `scripts/rss/hybrid-clustering.js`

**CORRECT PATTERN:** Slug match satisfies guardrail condition, does NOT bypass it:

```javascript
// Around line 159-204, REPLACE the existing guardrail logic:

// TTRC-306: Topic slug match as one of the "reasons to cluster"
const slugsMatch = article.topic_slug &&
                   story.topic_slugs?.includes(article.topic_slug);

const hasNonStopwordEntityOverlap = scoreResult.nonStopwordEntityOverlapCount > 0;
const hasDecentEmbedding = scoreResult.embeddingScore >= GUARDRAIL.minEmbedding;  // 0.60
const hasTitleMatch = scoreResult.titleScore >= GUARDRAIL.minTitle;  // 0.50

// TTRC-306: slugsMatch is now one of the valid "reasons to cluster"
// This keeps the guardrail in one place - no separate early-return branch
const passesGuardrail =
  hasDecentEmbedding &&
  (slugsMatch || hasNonStopwordEntityOverlap || hasTitleMatch);

if (!passesGuardrail) {
  // Log blocked cluster for debugging/tuning
  console.log(`[cluster-guardrail-block] Article ${articleId} blocked from story ${story.id}:`, {
    totalScore: scoreResult.total.toFixed(3),
    threshold: threshold.toFixed(3),
    embeddingScore: scoreResult.embeddingScore.toFixed(3),
    titleScore: scoreResult.titleScore.toFixed(3),
    nonStopwordEntityOverlapCount: scoreResult.nonStopwordEntityOverlapCount,
    slugsMatch,  // NEW: log slug match status
    articleSlug: article.topic_slug,
    storySlugs: story.topic_slugs,
  });
  // Fall through to create new story
} else {
  // Calculate bonus for slug match WITHIN normal scoring flow
  let finalScore = scoreResult.total;
  if (slugsMatch) {
    finalScore = Math.min(finalScore + BONUSES.topicSlugMatch, 1.0);
    console.log(`[cluster-slug-match] Article ${article.id} matched story ${story.id} via slug "${article.topic_slug}"`);
  }

  // Attach to existing story (existing logic)
  const result = await attachToStory(article, story, finalScore);
  // ... rest of attach logic ...
}
```

**Why this is safer:**
- Slug match STILL requires embedding >= 0.60 (guardrail maintained)
- Model mistakes don't create hard false positives
- All clustering decisions go through ONE guardrail check
- Slug is a "strong nudge" not an "override"

**IMPORTANT: Single source of truth for thresholds:**
- `GUARDRAIL.minEmbedding` (0.60) and `GUARDRAIL.minTitle` (0.50) are defined in `scoring.js`
- Import them: `import { GUARDRAIL } from './scoring.js'`
- **Never hardcode these values elsewhere** - always reference the GUARDRAIL object

### File: `scripts/rss/candidate-generation.js`

Add slug-based candidate block:

```javascript
// New function around line 150:
async function getSlugBlockCandidates(article) {
  if (!article.topic_slug) return [];

  const { data } = await supabase
    .from('stories')
    .select('id, primary_headline, centroid_embedding_v1, entity_counter, topic_slugs, last_updated_at')
    .in('lifecycle_state', ACTIVE_LIFECYCLE_STATES)  // Same filters as other blocks
    .contains('topic_slugs', [article.topic_slug])  // GIN index lookup
    .limit(10);

  return data || [];
}

// In generateCandidates(), add to OR-blocking union:
const slugCandidates = await getSlugBlockCandidates(article);

// Deduplicate across all candidate sources (time, entity, ANN, slug)
// NOTE: All candidate arrays must have consistent shape (id, primary_headline, centroid_embedding_v1, entity_counter, topic_slugs, last_updated_at)
// Cap at 200 candidates to bound scoring cost - this is an intentional design limit
const candidates = Array.from(new Map(
  [...timeCandidates, ...entityCandidates, ...annCandidates, ...slugCandidates]
    .map(s => [s.id, s])
).values()).slice(0, 200);
```

**Key points:**
- Deduplicate by story ID across all candidate blocks
- Same lifecycle filters as other blocks
- Slug block is just another candidate source, still scored through normal guardrail
- **Consistent shape required:** All candidate arrays must return same fields (id, primary_headline, centroid_embedding_v1, entity_counter, topic_slugs, last_updated_at)
- **200 candidate cap:** Intentional design limit to bound scoring cost per article

---

## Phase 5: Story Slug Aggregation (15 min)

### File: `scripts/rss/hybrid-clustering.js`

Update `attachToStory()` function around line 290:

```javascript
// After updating entity_counter, aggregate topic slugs:
// TODO: If attach volume grows significantly, consider replacing SELECT+UPDATE
// with single UPDATE using array_append + DISTINCT. Current approach is fine at scale.
if (article.topic_slug) {
  const { data: currentStory } = await getSupabaseClient()
    .from('stories')
    .select('topic_slugs')
    .eq('id', storyId)
    .single();

  const existingSlugs = currentStory?.topic_slugs || [];
  if (!existingSlugs.includes(article.topic_slug)) {
    await getSupabaseClient()
      .from('stories')
      .update({ topic_slugs: [...existingSlugs, article.topic_slug] })
      .eq('id', storyId);
  }
}
```

Update `createNewStory()` function around line 350:

```javascript
// In story insert, add topic_slugs:
const initialSlugs = article.topic_slug ? [article.topic_slug] : [];

const { data: story } = await getSupabaseClient()
  .from('stories')
  .insert({
    // ... existing fields ...
    topic_slugs: initialSlugs,  // NEW
  })
```

---

## Phase 6: Backfill Script (30 min)

### File: `scripts/backfill-topic-slugs.mjs` (NEW)

```javascript
#!/usr/bin/env node
/**
 * TTRC-306: Backfill topic slugs for existing articles
 * Cost: ~$0.92 for 1,830 articles
 *
 * Usage:
 *   node scripts/backfill-topic-slugs.mjs [--limit N] [--since YYYY-MM-DD]
 *
 * Options:
 *   --limit N       Process only N articles (for testing)
 *   --since DATE    Only process articles published after DATE
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { extractTopicSlug } from './rss/topic-extraction.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Parse CLI args
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const sinceIdx = args.indexOf('--since');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : null;
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : null;

async function backfillTopicSlugs() {
  console.log('TTRC-306: Backfilling topic slugs...');
  if (limit) console.log(`  --limit ${limit}`);
  if (since) console.log(`  --since ${since}`);

  // Get articles without slugs (use scraped_content || excerpt)
  let query = supabase
    .from('articles')
    .select('id, title, scraped_content, excerpt')
    .is('topic_slug', null)
    .order('published_at', { ascending: false });

  if (since) {
    query = query.gte('published_at', since);
  }
  if (limit) {
    query = query.limit(limit);
  }

  const { data: articles, error } = await query;
  if (error) throw error;

  console.log(`Found ${articles.length} articles without slugs`);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const MAX_ERROR_LOG = 25;  // Cap full error logs to keep output sane

  for (const article of articles) {
    try {
      // Use scraped_content || excerpt consistently
      const slug = await extractTopicSlug(
        article.title,
        article.scraped_content || '',
        article.excerpt || ''
      );

      if (slug) {
        await supabase
          .from('articles')
          .update({ topic_slug: slug })
          .eq('id', article.id);

        succeeded++;
      } else {
        failed++;
      }

      processed++;

      if (processed % 50 === 0) {
        console.log(`Progress: ${processed}/${articles.length} (${succeeded} slugs, ${failed} failed)`);
      }

      // Rate limit: ~2 per second
      await new Promise(r => setTimeout(r, 500));

    } catch (err) {
      failed++;
      if (failed <= MAX_ERROR_LOG) {
        console.error(`Error processing ${article.id}:`, err.message);
      } else if (failed === MAX_ERROR_LOG + 1) {
        console.error(`... suppressing further error details (${MAX_ERROR_LOG} logged)`);
      }
    }
  }

  console.log('\nBackfill complete!');
  console.log(`Total: ${processed}, Succeeded: ${succeeded}, Failed: ${failed}`);
}

backfillTopicSlugs().catch(console.error);
```

**Usage examples:**
```bash
# Full backfill (all ~1830 articles)
node scripts/backfill-topic-slugs.mjs

# Test run with 10 articles
node scripts/backfill-topic-slugs.mjs --limit 10

# Backfill only articles from last week
node scripts/backfill-topic-slugs.mjs --since 2025-12-03
```

---

## Phase 7: Re-cluster After Backfill (1 hour)

After backfill completes:

```bash
# 1. Delete existing article_story links and stories
# (Use existing recluster-all.mjs script)
node scripts/recluster-all.mjs --full

# 2. Monitor progress
# Should take ~30 min for 1,830 articles
```

---

## Phase 8: Validation (30 min)

### Validation Checklist

1. **Check slug distribution:**
   ```sql
   SELECT topic_slug, COUNT(*) as article_count
   FROM articles
   WHERE topic_slug IS NOT NULL
   GROUP BY topic_slug
   ORDER BY article_count DESC
   LIMIT 20;
   ```

2. **Check story slug aggregation:**
   ```sql
   SELECT id, primary_headline, array_length(topic_slugs, 1) as slug_count
   FROM stories
   WHERE array_length(topic_slugs, 1) > 1
   ORDER BY slug_count DESC
   LIMIT 10;
   ```

3. **Verify multi-article stories increased:**
   - Before: 26 multi-article stories
   - Target: 60-80 multi-article stories

4. **Spot check slug quality:**
   - Pick 10 random slugs, verify articles with same slug are about same event

5. **FP rate monitoring (CRITICAL):**
   ```bash
   # Run diagnostic script from TTRC-307 (Diagnostic Baseline ticket under TTRC-301)
   # See: scripts/analyze-cluster-scores.mjs
   node scripts/analyze-cluster-scores.mjs
   ```

   **If FP rate creeps back above 10%:**
   - Option A: Reduce `BONUSES.topicSlugMatch` from 0.08 → 0.05
   - Option B: Require `slugsMatch && hasTitleMatch` (not OR)
   - Option C: Add stricter embedding threshold for slug matches (0.65 instead of 0.60)

6. **Column name verification:**
   - Confirm `articles` table has columns: `scraped_content`, `excerpt` (not `content`)
   - These are used consistently across extraction function, worker integration, and backfill script

---

## Documentation Updates Required

After implementation, update:

1. **`CLAUDE.md`** - Add topic_slug to schema section
2. **`docs/architecture/clustering-scoring.md`** - Document slug scoring
3. **`docs/handoffs/2025-12-10-ttrc-306-topic-slugs.md`** - Create handoff
4. **JIRA TTRC-306** - Update status and add implementation notes

---

## JIRA Updates Required

1. **TTRC-306**: Move to "In Progress", add implementation plan link
2. **TTRC-301**: Add comment noting slug work as follow-up
3. Create sub-tasks if desired:
   - TTRC-306a: Schema changes
   - TTRC-306b: Extraction function
   - TTRC-306c: Clustering integration
   - TTRC-306d: Backfill

---

## Cost Summary

| Phase | Cost |
|-------|------|
| Backfill 1,830 articles | ~$0.92 |
| Ongoing (~30 articles/day) | ~$0.45/month |
| **Total first month** | **~$1.40** |

Well within $50/month budget.

---

## Files to Create/Modify

| File | Action | Lines Changed |
|------|--------|---------------|
| `migrations/XXX_add_topic_slug.sql` | CREATE | ~15 |
| `scripts/rss/topic-extraction.js` | CREATE | ~80 |
| `scripts/backfill-topic-slugs.mjs` | CREATE | ~70 |
| `scripts/job-queue-worker.js` | MODIFY | +10 |
| `scripts/rss/scoring.js` | MODIFY | +5 |
| `scripts/rss/hybrid-clustering.js` | MODIFY | +30 |
| `scripts/rss/candidate-generation.js` | MODIFY | +20 |
| `CLAUDE.md` | MODIFY | +10 |
| `docs/architecture/clustering-scoring.md` | MODIFY | +30 |

---

## Success Criteria

| Metric | Current | Target |
|--------|---------|--------|
| Multi-article stories | 26 | 60-80 |
| Total stories | 1,731 | ~1,500 |
| False positive rate | 17% | <10% |
| Slug coverage | 0% | >95% |

---

## Ready for Implementation

This plan is complete and ready for implementation. Next steps:
1. Update JIRA TTRC-306 to "In Progress"
2. Implement Phase 1-8 sequentially
3. Run validation
4. Update documentation
5. Create handoff
