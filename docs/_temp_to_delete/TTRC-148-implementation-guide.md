# TTRC-148 • Story Enrichment Implementation Guide

**Phase 1: Core Enrichment Handler**  
**Estimated Time:** 2-3 hours  
**Status:** Ready for Implementation

---

## Quick Start

This guide provides **exact prompts**, **file structure**, and **code skeletons** for implementing Phase 1 of story enrichment. Follow sections in order.

---

## 0. Scope (Phase 1 Only)

**What we're building:**
- Add `enrichStory()` handler to job queue worker
- Generate neutral + spicy summaries via OpenAI (JSON mode)
- Map UI category labels → DB enum values
- Update `stories` table with enrichment data
- Track API costs

**What we're NOT doing yet:**
- Database migrations (Phase 2)
- Backfill scripts (Phase 3)
- Auto-triggers (Phase 4)
- Frontend polish (Phase 5)

**Important:** Budget RPC calls are optional in Phase 1 - skip if migration 008 not deployed yet.

---

## 1. File Structure

### New Files

**`scripts/enrichment/prompts.js`**
- Exports system prompt constant
- Exports user payload builder function

### Modified Files

**`scripts/job-queue-worker.js`**
- Add category mapping constant (top of file)
- Register `story.enrich` handler in constructor
- Implement `enrichStory(payload)` method

---

## 2. Prompts (Use Verbatim)

### 2.1 System Prompt

```javascript
export const SYSTEM_PROMPT = `You are a political analyst. Return ONLY valid JSON (a single JSON object), no prose.

Generate TWO summaries of the story based solely on the provided article snippets:

- summary_neutral: ~100–140 words. Strictly factual, concise, no hype, no opinion, no loaded language. Include names, dates, and numbers when present.
- summary_spicy: ~100–140 words. Still truthful, but punchy/engaging. Highlight hypocrisy, stakes, and real-world impact. No profanity. No new facts beyond the snippets. Clear, active voice.

Also extract:
- category: one of [Corruption & Scandals; Democracy & Elections; Policy & Legislation; Justice & Legal; Executive Actions; Foreign Policy; Corporate & Financial; Civil Liberties; Media & Disinformation; Epstein & Associates; Other]
- severity: one of [critical, severe, moderate, minor]
- primary_actor: main person or organization (string)

Rules:
- Use ONLY the provided snippets; do not speculate. If uncertain, keep it neutral.
- Do not include citations or URLs in summaries.
- Output must be valid JSON with these exact keys: summary_neutral, summary_spicy, category, severity, primary_actor.`;
```

### 2.2 User Payload Builder

```javascript
export function buildUserPayload({ primary_headline, articles }) {
  const lines = [];
  lines.push('Story context');
  lines.push(`Headline: ${primary_headline || ''}`);
  lines.push('');
  lines.push('Articles (max 6; title + brief excerpt):');
  for (const a of articles) {
    lines.push(`- Title: ${a.title} | Source: ${a.source_name}`);
    lines.push(`  ${a.excerpt}`);
    lines.push('---');
  }
  return lines.join('\n');
}
```

**Implementation Notes:**
- `excerpt` = from `content` or `excerpt` field
- Strip HTML tags
- Truncate to ~300 chars per article
- Cap total input to ~1.5-2K tokens

### 2.3 Expected JSON Response

```json
{
  "summary_neutral": "100–140 words...",
  "summary_spicy": "100–140 words (engaging, still factual)...",
  "category": "Democracy & Elections",
  "severity": "moderate",
  "primary_actor": "Donald Trump"
}
```

---

## 3. Category Mapping (UI → DB)

Add at the **top** of `scripts/job-queue-worker.js`:

```javascript
// Category mapping: UI labels → DB enum values
const UI_TO_DB = {
  'Corruption & Scandals': 'corruption_scandals',
  'Democracy & Elections': 'democracy_elections',
  'Policy & Legislation': 'policy_legislation',
  'Justice & Legal': 'justice_legal',
  'Executive Actions': 'executive_actions',
  'Foreign Policy': 'foreign_policy',
  'Corporate & Financial': 'corporate_financial',
  'Civil Liberties': 'civil_liberties',
  'Media & Disinformation': 'media_disinformation',
  'Epstein & Associates': 'epstein_associates',
  'Other': 'other',
};

const toDbCategory = (label) => UI_TO_DB[label] || 'other';
```

**Why:** DB uses underscored enums, but GPT returns pretty labels from prompt. This mapping translates them.

---

## 4. Implementation - `enrichStory()` Handler

### 4.1 Complete Code Skeleton

Add to `scripts/job-queue-worker.js`:

```javascript
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { SYSTEM_PROMPT, buildUserPayload } from './enrichment/prompts.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// In constructor, register handler:
// this.handlers['story.enrich'] = this.enrichStory.bind(this);

/**
 * Fetch up to 6 articles for a story, ordered by relevance
 */
async function fetchStoryArticles(story_id) {
  const { data, error } = await supabase
    .from('article_story')
    .select('is_primary_source, similarity_score, matched_at, articles(*)')
    .eq('story_id', story_id)
    .order('is_primary_source', { ascending: false })
    .order('similarity_score', { ascending: false })
    .order('matched_at', { ascending: false })
    .limit(6);
    
  if (error) throw new Error(`Failed to fetch articles: ${error.message}`);
  return (data || []).filter(r => r.articles);
}

/**
 * Phase 1: Story Enrichment Handler
 * Generates summaries, categorizes, and updates story
 */
export async function enrichStory(payload) {
  const { story_id } = payload || {};
  if (!story_id) throw new Error('story_id required');

  // ========================================
  // 1. COOLDOWN CHECK (12 hours)
  // ========================================
  const { data: story, error: sErr } = await supabase
    .from('stories')
    .select('id, primary_headline, last_enriched_at')
    .eq('id', story_id)
    .single();
    
  if (sErr) throw new Error(`Failed to fetch story: ${sErr.message}`);
  
  const cooldownMs = 12 * 60 * 60 * 1000; // 12 hours
  if (story.last_enriched_at) {
    const elapsed = Date.now() - new Date(story.last_enriched_at).getTime();
    if (elapsed < cooldownMs) {
      return { 
        status: 429, 
        message: 'Cooldown active',
        retry_after: cooldownMs - elapsed 
      };
    }
  }

  // ========================================
  // 2. BUDGET CHECK (Optional - Phase 2)
  // ========================================
  // TODO: Add budget soft/hard stop once migration 008 is deployed
  // const today = new Date().toISOString().slice(0, 10);
  // const { data: budget } = await supabase
  //   .from('budgets')
  //   .select('spent_usd, cap_usd')
  //   .eq('day', today)
  //   .single();
  // 
  // const estimatedCost = 0.000405; // avg per story
  // if (budget && budget.spent_usd + estimatedCost > budget.cap_usd * 0.9) {
  //   return { status: 429, message: 'Budget exceeded' };
  // }

  // ========================================
  // 3. FETCH ARTICLES & BUILD CONTEXT
  // ========================================
  const links = await fetchStoryArticles(story_id);
  if (!links.length) {
    console.error(`❌ No articles found for story ${story_id}`);
    throw new Error('No articles found for story');
  }

  // Build article snippets (strip HTML, truncate to ~300 chars)
  const articles = links.map(({ articles }) => ({
    title: articles.title || '',
    source_name: articles.source_name || '',
    excerpt: (articles.content || articles.excerpt || '')
      .replace(/<[^>]+>/g, ' ')    // strip HTML tags
      .replace(/\s+/g, ' ')         // collapse whitespace
      .trim()
      .slice(0, 300)
  }));

  const userPayload = buildUserPayload({
    primary_headline: story.primary_headline || '',
    articles
  });

  // ========================================
  // 4. OPENAI CALL (JSON MODE)
  // ========================================
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPayload }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 500,
    temperature: 0.7
  });

  // ========================================
  // 5. PARSE & VALIDATE JSON
  // ========================================
  const text = completion.choices?.[0]?.message?.content || '{}';
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error('Model did not return valid JSON');
  }

  // Extract and validate fields
  const summary_neutral = obj.summary_neutral?.trim();
  const summary_spicy = (obj.summary_spicy || summary_neutral || '').trim();
  const category_db = obj.category ? toDbCategory(obj.category) : null;
  const severity = ['critical', 'severe', 'moderate', 'minor'].includes(obj.severity) 
    ? obj.severity 
    : 'moderate';
  const primary_actor = (obj.primary_actor || '').trim() || null;

  if (!summary_neutral) {
    throw new Error('Missing summary_neutral in response');
  }

  // ========================================
  // 6. UPDATE STORY
  // ========================================
  const { error: uErr } = await supabase
    .from('stories')
    .update({
      summary_neutral,
      summary_spicy,
      category: category_db,
      severity,
      primary_actor,
      last_enriched_at: new Date().toISOString()
    })
    .eq('id', story_id);
    
  if (uErr) throw new Error(`Failed to update story: ${uErr.message}`);

  // ========================================
  // 7. COST TRACKING (with guards)
  // ========================================
  const usage = completion.usage || { prompt_tokens: 0, completion_tokens: 0 };
  const costInput = (usage.prompt_tokens / 1000) * 0.00015;  // GPT-4o-mini input
  const costOutput = (usage.completion_tokens / 1000) * 0.0006; // GPT-4o-mini output
  const totalCost = costInput + costOutput;

  // Optional: Track in budgets table (Phase 2)
  // if (Phase 2 RPC exists) {
  //   const today = new Date().toISOString().slice(0, 10);
  //   await supabase.rpc('increment_budget', {
  //     p_day: today,
  //     p_cost: totalCost,
  //     p_calls: 1
  //   });
  // }

  console.log(`✅ Enriched story ${story_id}:`, {
    tokens: usage,
    cost: `$${totalCost.toFixed(6)}`,
    category: category_db,
    severity
  });

  return { 
    story_id, 
    tokens: usage, 
    cost: totalCost,
    summary_neutral,
    summary_spicy,
    category: category_db,
    severity,
    primary_actor
  };
}
```

### 4.2 Register Handler in Constructor

In the worker class constructor:

```javascript
constructor() {
  // Use spread operator to preserve existing handlers
  this.handlers = {
    ...(this.handlers || {}),
    'story.enrich': this.enrichStory.bind(this),
  };
}
```

---

## 5. Pre-Implementation Checklist

**CRITICAL:** Review this entire checklist before writing any code. These requirements prevent common implementation failures.

### Must-Haves (Blockers if Missing)

**1. Handler Registered with Spread Operator**
```javascript
// ✅ CORRECT - Preserves existing handlers
this.handlers = { 
  ...(this.handlers || {}), 
  'story.enrich': this.enrichStory.bind(this) 
};

// ❌ WRONG - Overwrites existing handlers
this.handlers = {
  'story.enrich': this.enrichStory.bind(this)
};
```
**Why critical:** Without spread operator, you'll break existing job handlers (RSS processing, etc.)

**2. Environment Variables Present**
Verify these are set where the worker runs:
- `OPENAI_API_KEY` - Your OpenAI API key
- `SUPABASE_URL` - Supabase project URL  
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (bypasses RLS)

Check with:
```bash
echo $OPENAI_API_KEY
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_ROLE_KEY
```

**Why critical:** Missing env vars cause runtime failures that only show up when jobs run.

**3. Import Path Correctness**
Ensure path matches your actual file tree:
```javascript
import { SYSTEM_PROMPT, buildUserPayload } from './enrichment/prompts.js';
```

**Verify:**
- Is `enrichment/` folder actually at `scripts/enrichment/`?
- Does your repo use ESM (`"type": "module"` in package.json)?
- Are you using `.js` extensions in imports?

**Why critical:** Import path errors fail immediately on startup, blocking all job processing.

---

### Strongly Recommended (Not Hard Blockers)

**RLS/Permissions Sanity Check**
- Worker uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS)
- Verify service role can read `stories`, `article_story`, `articles` tables
- Verify service role can write to `stories` table

**Why recommended:** Prevents cryptic "permission denied" errors during first real run.

**"No Articles" Logging Before Throwing**
```javascript
const links = await fetchStoryArticles(story_id);
if (!links.length) {
  console.error(`❌ No articles found for story ${story_id}`);
  throw new Error('No articles found for story');
}
```

**Why recommended:** Helps diagnose which stories are failing and why during testing.

---

### Nice-to-Haves (Polish/Safety)

**OpenAI Retries with Exponential Backoff**
```javascript
let attempt = 0;
let completion;
while (attempt < 3) {
  try {
    completion = await openai.chat.completions.create({...});
    break;
  } catch (err) {
    if (err.status === 429 || err.status >= 500) {
      attempt++;
      const delay = 1000 * Math.pow(2, attempt);
      console.warn(`⚠️ OpenAI error (attempt ${attempt}/3), retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    } else {
      throw err;
    }
  }
}
if (!completion) {
  throw new Error('OpenAI call failed after 3 attempts');
}
```

**Why nice:** Handles occasional 429 (rate limit) or 5xx (server error) from OpenAI gracefully.

**Total Payload Clamp (Defensive)**
```javascript
// Defensive: clamp total input to ~2K tokens max
let userPayload = buildUserPayload({...});
if (userPayload.length > 8000) { // ~2K tokens (~4 chars/token)
  console.warn(`⚠️ Payload too long (${userPayload.length} chars), truncating to 8000`);
  userPayload = userPayload.slice(0, 8000);
}
```

**Why nice:** Prevents extremely long articles from blowing up token limits.

**JSON Missing-Key Warnings (QA Friendly)**
```javascript
if (!obj.summary_neutral) {
  console.warn('⚠️ Missing summary_neutral in response:', text.slice(0, 200));
  throw new Error('Missing summary_neutral in response');
}
if (!obj.category) {
  console.warn('⚠️ Missing category in response, defaulting to "other"');
}
if (!obj.severity) {
  console.warn('⚠️ Missing severity in response, defaulting to "moderate"');
}
```

**Why nice:** Makes QA easier by showing what's missing in logs instead of silent failures.

---

## 6. Testing Phase 1

### 6.1 Manual Test Script

Create `scripts/test-enrichment-single.js`:

```javascript
import { createClient } from '@supabase/supabase-js';
import { enrichStory } from './job-queue-worker.js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testEnrichment() {
  // Get a story without summaries
  const { data: story } = await supabase
    .from('stories')
    .select('id, primary_headline')
    .is('summary_neutral', null)
    .limit(1)
    .single();

  if (!story) {
    console.log('❌ No unenriched stories found');
    return;
  }

  console.log(`🧪 Testing enrichment on story ${story.id}`);
  console.log(`   Headline: ${story.primary_headline}\n`);

  try {
    const result = await enrichStory({ story_id: story.id });
    console.log('✅ Success:', result);
  } catch (error) {
    console.error('❌ Failed:', error.message);
  }
}

testEnrichment();
```

### 6.2 Run Test

```bash
node scripts/test-enrichment-single.js
```

### 6.3 Verify Results

Check the database:

```sql
SELECT 
  id,
  primary_headline,
  summary_neutral,
  summary_spicy,
  category,
  severity,
  primary_actor,
  last_enriched_at
FROM stories
WHERE id = <test_story_id>;
```

---

## 7. Acceptance Criteria (Phase 1)

**Must Have:**
- ✅ Worker processes `story.enrich` job without error
- ✅ Story updated with all 5 fields:
  - `summary_neutral` (required)
  - `summary_spicy` (fallback to neutral OK)
  - `category` (mapped to DB enum)
  - `severity` (validated)
  - `primary_actor` (nullable)
- ✅ `last_enriched_at` timestamp set
- ✅ Cost calculated without throwing (guards for undefined usage)
- ✅ 12-hour cooldown enforced
- ✅ UI displays spicy > neutral > headline

**Nice to Have (Phase 2+):**
- Budget RPC tracking
- Soft/hard stop on budget
- Multiple enrichment attempts

---

## 8. Cost Reality Check

| Scenario | Tokens | Cost |
|----------|--------|------|
| Per story (avg) | 1.5K input + 300 output | **$0.000405** |
| Backfill 82 stories | 123K + 24.6K | **$0.033** (3 cents!) |
| Monthly (150 stories) | 225K + 45K | **$0.06** (6 cents!) |
| **Yearly total** | ~1800 stories | **~$0.73** |

✅ **Essentially FREE** - entire year < $1

---

## 9. Common Issues & Solutions

### Issue: "Model did not return valid JSON"

**Cause:** GPT returned prose instead of JSON  
**Fix:** Ensure `response_format: { type: 'json_object' }` is set

### Issue: "Missing summary_neutral in response"

**Cause:** Model didn't include required field  
**Fix:** Check system prompt is passed correctly

### Issue: Category shows underscores in UI

**Cause:** Mapping not applied or missing formatter  
**Fix:** Verify `toDbCategory()` is used before DB write

### Issue: Cost is $0.00

**Cause:** `completion.usage` is undefined  
**Fix:** Guards already in place - this is OK for Phase 1

### Issue: Cooldown not working

**Cause:** `last_enriched_at` not being set  
**Fix:** Verify UPDATE query includes this field

---

## 10. Next Phases (Reference)

### Phase 2: Database Helpers (30 min)
- Migration 008: indexes + RPC
- `increment_budget` function
- Unique job idempotency constraint

### Phase 3: Backfill Script (1 hour)
- Query unenriched stories
- Enqueue with delays
- Dry-run support

### Phase 4: Auto-Trigger (30 min)
- Trigger on story creation
- Trigger on status change (closed→active)

### Phase 5: Frontend Polish (30 min)
- Modal deduplication check
- AI badge display
- Error vs no-sources states

---

## 11. Reference Links

**JIRA Cards:**
- Parent: [TTRC-148](https://ajwolfe37.atlassian.net/browse/TTRC-148) - Story Enrichment (Overall)
- Phase 1: [TTRC-189](https://ajwolfe37.atlassian.net/browse/TTRC-189) - Core Handler
- Phase 2: [TTRC-190](https://ajwolfe37.atlassian.net/browse/TTRC-190) - Database Helpers
- Phase 3: [TTRC-191](https://ajwolfe37.atlassian.net/browse/TTRC-191) - Backfill Script
- Phase 4: [TTRC-192](https://ajwolfe37.atlassian.net/browse/TTRC-192) - Auto-Trigger
- Phase 5: [TTRC-193](https://ajwolfe37.atlassian.net/browse/TTRC-193) - Frontend Polish

**Documentation:**
- Confluence: https://ajwolfe37.atlassian.net/wiki/x/A4AlAg
- Handoff: `/docs/handoffs/2025-10-03-ttrc-148-implementation-plan.md`

---

**Last Updated:** October 3, 2025  
**Status:** Ready for Implementation  
**Estimated Time:** 2-3 hours for Phase 1
