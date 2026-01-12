# RSS Feed Filtering Implementation Plan

**Date:** 2025-11-12  
**Context:** TTRC-255 Feed Expansion + Content Filtering  
**Goal:** Filter RSS feeds to focus on Trump & US federal politics, eliminate UK/local/state noise  
**Cost:** $0/month | **Effort:** 90 minutes + 48h monitoring

---

## Problem Statement

Current RSS feeds are ingesting irrelevant content:
- **UK Politics:** Guardian/BBC publishing UK Parliament, Welsh/Scottish devolution
- **Local News:** CSM publishing Maine/NYC city council stories
- **State Politics:** "Maine's Graham Platner" gubernatorial races
- **Character Encoding:** Titles showing `&#8217;` instead of apostrophes

**User Requirements:**
1. Focus on Trump and US federal government
2. Eliminate local/state/UK political news
3. Fix character encoding bugs

---

## Architecture: Hybrid Rule-Based Scorer

### Core Design Principles

1. **Zero New Infrastructure** - Single JSONB column, no new tables/services
2. **URL Gates First** - Fast-fail on section/path before expensive regex
3. **Boosts Before Blocks** - Federal/Trump signals applied before local penalties
4. **Feed-Specific Config** - Per-feed rules prevent global blocklist breaking sources
5. **Explainable Logs** - Score breakdown for rapid tuning

### Scoring Algorithm

```
Gate Phase (hard reject):
  - requiredUrlIncludes miss → score = -1, DROP
  - disallowedUrlIncludes hit → score = -1, DROP

Score Phase (additive):
  +2: Federal keywords (Congress, DOJ, SCOTUS, etc.)
  +2: Trump mentions (Trump, MAGA, Mar-a-Lago)
  +1: US politics URL path (/us-news/, /politics/, /congress/)
  +1: Swing state federal context (Pennsylvania Senate race)
  -1: Negative URL path (/uk-news/, /local/, /opinion/, /live/)
  -1: Local blocks IF Trump present (softened penalty)
  -2: Local blocks IF no Trump/federal signals

Keep if score ≥ 1, DROP otherwise
```

---

## Implementation Components

### 1. Database Schema Changes

**Add filter config column:**
```sql
ALTER TABLE feed_registry
  ADD COLUMN IF NOT EXISTS filter_config jsonb NOT NULL DEFAULT '{}'::jsonb;
```

**Add monitoring view:**
```sql
CREATE OR REPLACE VIEW admin.feed_filter_stats AS
SELECT
  fr.id AS feed_id,
  fr.source_name AS feed_name,
  COALESCE(m.kept_24h, 0) AS kept_24h,
  COALESCE(m.dropped_24h, 0) AS dropped_24h,
  ROUND(100.0 * COALESCE(m.dropped_24h,0) / NULLIF(COALESCE(m.kept_24h,0)+COALESCE(m.dropped_24h,0),0), 1)
    AS drop_rate_pct
FROM feed_registry fr
LEFT JOIN admin.feed_metrics_24h m ON m.feed_id = fr.id;
```

**No new tables required.**

---

### 2. Feed Configuration Updates

**Feed Changes from Original TTRC-255 Plan:**

| Original Plan | Revised Plan | Reason |
|--------------|--------------|--------|
| Add BBC Politics | ~~Remove~~ Disable | No US-specific feed available |
| Add Guardian Politics | Add Guardian US Politics | US-focused alternative exists |
| - | **NEW:** Add Guardian Trump | Dedicated Trump coverage |
| Keep Politico Top | **NEW:** Add Politico Trump | More focused than "Top News" |
| Add Economist US | Keep as planned | Already US-focused |

**Guardian US Politics Config:**
```sql
UPDATE feed_registry
SET filter_config = jsonb_build_object(
  'requiredUrlIncludes', ARRAY['/us-news/','/politics/','/donaldtrump','/trump'],
  'disallowedUrlIncludes', ARRAY['/uk-news/','/live/','/opinion/','/podcast/','/video/','/culture/'],
  'allow', ARRAY[
    'Congress','Senate','House','White House','Supreme Court','SCOTUS','executive order',
    'Department of Justice','DOJ','FBI','CIA','NSA','DHS','ICE','CBP','DOD','Pentagon','Treasury',
    'State Department','ATF','DEA','federal','federal court','5th Circuit','DC Circuit'
  ],
  'block', ARRAY[
    'city council','school board','borough','county commission','mayor','mayoral',
    'gubernatorial','state legislature','town meeting'
  ]
)
WHERE source_domain = 'theguardian.com';
```

**Politico Trump Config:**
```sql
UPDATE feed_registry
SET filter_config = jsonb_build_object(
  'requiredUrlIncludes', ARRAY['/trump','/white-house','/congress','/elections'],
  'disallowedUrlIncludes', ARRAY['/local/','/opinion/','/podcast/','/video/'],
  'allow', ARRAY['Congress','White House','Supreme Court','SCOTUS','executive order','DOJ','DHS','federal'],
  'block', ARRAY['city council','county','mayor','state legislature','gubernatorial']
)
WHERE source_domain = 'politico.com';
```

**CSM Politics Config:**
```sql
UPDATE feed_registry
SET filter_config = jsonb_build_object(
  'allow', ARRAY['federal','Congress','White House','Supreme Court','DOJ','FBI','ICE','DHS','Pentagon','federal court'],
  'block', ARRAY['city council','school board','zoning board','county commission','mayoral','gubernatorial','Maine','Vermont']
)
WHERE source_name = 'Christian Science Monitor';
```

---

### 3. Rule-Based Scorer

**File:** `scripts/rss/scorer.js`

**Full implementation:**

```javascript
// scripts/rss/scorer.js
import he from 'he';

const FED_ALLOW_RX = [
  /\bcongress\b/i, 
  /\bsenate\b/i, 
  /\bhouse (of representatives|judiciary|appropriations|oversight|ways and means)\b/i,
  /\bwhite house\b/i, 
  /\bsupreme court\b|\bscotus\b/i, 
  /\bexecutive order\b/i,
  /\bdepartment of (justice|defense|state|treasury|homeland security)\b/i,
  /\b(doj|dod|dhs|fbi|cia|nsa|ice|cbp|atf|dea)\b/i, 
  /\bfederal\b/i, 
  /\bfederal court\b/i,
  /\b(5th|9th|dc) circuit\b/i
];

const TRUMP_BOOST_RX = [
  /\btrump\b/i, 
  /\bmaga\b/i, 
  /mar-a-lago/i
];

const LOCAL_BLOCK_RX = [
  /\bcity council\b/i, 
  /\bschool board\b/i, 
  /\bborough\b/i, 
  /\bcounty (commission|board)\b/i,
  /\bmayor(al)?\b/i, 
  /\bgubernatorial\b/i, 
  /\bstate legislature\b/i, 
  /\btown meeting\b/i
];

const PATH_POS_RX = /(\/us-news\/|\/politics\/|\/elections\/|\/white-house\/|\/congress\/)/i;
const PATH_NEG_RX = /(\/uk-news\/|\/local\/|\/opinion\/|\/live\/|\/podcast\/|\/video\/|\/culture\/)/i;

function escapeRx(s) { 
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
}

export function scoreGovRelevance(item, feedFilter = {}) {
  const url = item.link || item.url || '';
  const title = item.title || '';
  const summary = item.contentSnippet || item.content || item.summary || '';
  const categories = item.categories || [];

  // Decode entities once, normalize to lower-case
  const hay = he.decode(`${title} ${summary} ${categories.join(' ')}`).toLowerCase();
  const path = (() => { 
    try { return new URL(url).pathname.toLowerCase(); } 
    catch { return ''; } 
  })();

  // URL gates (fast + strict)
  const req = (feedFilter.requiredUrlIncludes || []).map(s => s.toLowerCase());
  if (req.length && !req.some(seg => path.includes(seg))) {
    return { keep: false, score: -1, signals: { gate: 'miss', path } };
  }
  const disallow = (feedFilter.disallowedUrlIncludes || []).map(s => s.toLowerCase());
  if (disallow.some(seg => path.includes(seg))) {
    return { keep: false, score: -1, signals: { gate: 'disallowedPath', path } };
  }

  const cfgAllow = (feedFilter.allow || []).map(s => new RegExp(`\\b${escapeRx(s)}\\b`, 'i'));
  const cfgBlock = (feedFilter.block || []).map(s => new RegExp(s, 'i'));

  let score = 0;
  const signals = { allow: [], block: [], trump: false, path: 0 };

  // Positive URL hints
  if (PATH_POS_RX.test(path)) { score += 1; signals.path += 1; }
  if (PATH_NEG_RX.test(path)) { score -= 1; signals.path -= 1; }

  // Federal allows
  const fedHits = [...FED_ALLOW_RX, ...cfgAllow].filter(rx => rx.test(hay));
  if (fedHits.length) { 
    score += 2; 
    signals.allow = fedHits.map(r => r.toString()); 
  }

  // Trump boost (strong, applied before local blocks)
  const hasTrump = TRUMP_BOOST_RX.some(rx => rx.test(hay));
  if (hasTrump) { 
    score += 2; 
    signals.trump = true; 
  }

  // Local blocks (softened if Trump present)
  const localHits = [...LOCAL_BLOCK_RX, ...cfgBlock].filter(rx => rx.test(hay));
  if (localHits.length) {
    score += hasTrump ? -1 : -2;
    signals.block = localHits.map(r => r.toString());
  }

  return { keep: score >= 1, score, signals };
}
```

---

### 4. Worker Integration

**File:** `scripts/rss/fetch_feed.js`

**Add to imports:**
```javascript
import he from 'he';
import { scoreGovRelevance } from './scorer.js';
```

**Add filtering function:**
```javascript
function shouldKeepItem(item, feedConfig) {
  const result = scoreGovRelevance(item, feedConfig?.filter_config || {});
  
  if (!result.keep) {
    console.log(JSON.stringify({
      action: 'DROP',
      feed: feedConfig?.source_name || feedConfig?.source_domain,
      url: item.link,
      title: item.title,
      score: result.score,
      signals: result.signals
    }));
  }
  
  return result.keep;
}
```

**Integrate before article insert:**
```javascript
// In RSS processing loop, before creating article:
if (!shouldKeepItem(rssItem, feedRow)) {
  metrics.dropped++;
  continue;
}

// Proceed with article creation...
```

**Fix character encoding at parse time:**
```javascript
function normalizeRssItem(raw) {
  const title = he.decode(raw.title || '').trim();
  const summary = he.decode(raw.contentSnippet || raw.content || raw.summary || '').trim();
  
  return {
    ...raw,
    title,
    contentSnippet: summary
  };
}

// Use in RSS parser:
const normalizedItems = rssItems.map(normalizeRssItem);
```

---

### 5. Package Dependencies

**Install `he` for HTML entity decoding:**
```bash
npm install he
```

**Cost:** $0

---

## Rollout Plan (90 minutes + 48h monitoring)

### Phase 1: Database Changes (10 minutes)

1. Add `filter_config` column to `feed_registry`
2. Create `feed_filter_stats` monitoring view
3. Verify schema changes in TEST environment

### Phase 2: Feed Updates (20 minutes)

**Update Guardian (ID 180):**
```sql
UPDATE feed_registry 
SET 
  feed_url = 'https://www.theguardian.com/us-news/us-politics/rss',
  feed_name = 'Guardian US Politics',
  filter_config = jsonb_build_object(
    'requiredUrlIncludes', ARRAY['/us-news/','/politics/','/donaldtrump','/trump'],
    'disallowedUrlIncludes', ARRAY['/uk-news/','/live/','/opinion/','/podcast/','/video/','/culture/'],
    'allow', ARRAY['Congress','Senate','House','White House','Supreme Court','SCOTUS','executive order',
                   'DOJ','FBI','CIA','NSA','DHS','ICE','CBP','DOD','Pentagon','Treasury','State Department',
                   'ATF','DEA','federal','federal court','5th Circuit','DC Circuit'],
    'block', ARRAY['city council','school board','borough','county commission','mayor','mayoral',
                   'gubernatorial','state legislature','town meeting']
  )
WHERE id = 180;
```

**Add Guardian Trump feed:**
```sql
INSERT INTO feed_registry (feed_url, feed_name, source_name, topics, tier, source_tier, is_active, filter_config)
VALUES (
  'https://www.theguardian.com/us-news/donaldtrump/rss',
  'Guardian Trump',
  'The Guardian',
  ARRAY['politics','trump'],
  1,
  1,
  true,
  jsonb_build_object(
    'requiredUrlIncludes', ARRAY['/donaldtrump','/trump'],
    'allow', ARRAY['Congress','White House','DOJ','Supreme Court','federal'],
    'block', ARRAY['city council','mayor','state legislature']
  )
);

-- Add compliance rule
INSERT INTO feed_compliance_rules (feed_id, max_chars, allow_full_text, source_name, notes)
VALUES (
  (SELECT id FROM feed_registry WHERE feed_url = 'https://www.theguardian.com/us-news/donaldtrump/rss'),
  5000,
  false,
  'The Guardian',
  '5K char limit for RSS content - matches article scraping limit'
);
```

**Disable BBC Politics (ID 179):**
```sql
UPDATE feed_registry 
SET is_active = false
WHERE id = 179;
```

**Add Politico Trump feed:**
```sql
INSERT INTO feed_registry (feed_url, feed_name, source_name, topics, tier, source_tier, is_active, filter_config)
VALUES (
  'https://rss.politico.com/donald-trump.xml',
  'Politico Trump',
  'Politico',
  ARRAY['politics','trump'],
  1,
  2,
  true,
  jsonb_build_object(
    'requiredUrlIncludes', ARRAY['/trump','/white-house','/congress','/elections'],
    'disallowedUrlIncludes', ARRAY['/local/','/opinion/','/podcast/','/video/'],
    'allow', ARRAY['Congress','White House','Supreme Court','SCOTUS','executive order','DOJ','DHS','federal'],
    'block', ARRAY['city council','county','mayor','state legislature','gubernatorial']
  )
);

-- Add compliance rule
INSERT INTO feed_compliance_rules (feed_id, max_chars, allow_full_text, source_name, notes)
VALUES (
  (SELECT id FROM feed_registry WHERE feed_url = 'https://rss.politico.com/donald-trump.xml'),
  5000,
  false,
  'Politico',
  '5K char limit for RSS content - matches article scraping limit'
);
```

**Update CSM with filter config:**
```sql
UPDATE feed_registry
SET filter_config = jsonb_build_object(
  'allow', ARRAY['federal','Congress','White House','Supreme Court','DOJ','FBI','ICE','DHS','Pentagon','federal court'],
  'block', ARRAY['city council','school board','zoning board','county commission','mayoral','gubernatorial','Maine','Vermont']
)
WHERE id = 175;
```

**Update Economist (keep as-is, already US-focused):**
```sql
-- No changes needed for Economist US (ID 181)
```

### Phase 3: Code Changes (30 minutes)

1. Install `he` package: `npm install he`
2. Create `scripts/rss/scorer.js` with full implementation (copy from above)
3. Update `scripts/rss/fetch_feed.js`:
   - Import `he` and `scoreGovRelevance`
   - Add `normalizeRssItem()` function
   - Add `shouldKeepItem()` function
   - Integrate filter before article insert
4. Test locally with sample RSS item

### Phase 4: Deployment & Testing (30 minutes)

1. Deploy to TEST environment
2. Restart worker
3. Trigger manual RSS fetch: `bash scripts/monitoring/trigger-rss.sh`
4. Monitor worker logs for DROP entries
5. Check `feed_filter_stats` view for drop rates
6. Verify no false positives (check dropped Trump/federal stories)

### Phase 5: Monitoring & Tuning (48 hours)

**Hour 0-4:**
- Monitor initial RSS fetch
- Check for false positives in DROP logs
- Verify articles appearing in frontend

**Hour 4-24:**
- Trigger RSS 4-6 times
- Review DROP logs for patterns
- Adjust 1-2 keywords if needed

**Hour 24-48:**
- Check `feed_filter_stats` for drop rates
- Alert if any feed >70% drop rate
- Tune `requiredUrlIncludes` if over-filtering

**Success Metrics:**
- 35%+ reduction in irrelevant articles
- <5% false positives (missed Trump/federal stories)
- No new costs
- Character encoding bugs fixed

---

## Monitoring Queries

**Check drop rates by feed:**
```sql
SELECT * FROM admin.feed_filter_stats 
ORDER BY drop_rate_pct DESC;
```

**Alert on over-filtering:**
```sql
SELECT feed_id, feed_name, drop_rate_pct
FROM admin.feed_filter_stats
WHERE drop_rate_pct > 70
  AND kept_24h + dropped_24h > 10; -- minimum volume
```

**Sample dropped articles:**
```bash
# From worker logs
grep '"action":"DROP"' worker-*.log | jq '{feed: .feed, title: .title, score: .score, signals: .signals}' | head -20
```

---

## Edge Cases Handled

### 1. "Trump rally in Maine" (Trump + Local)
- **Before:** Dropped (-2 for "Maine")
- **After:** Kept (+2 Trump, -1 softened local = +1)

### 2. "Pennsylvania Senate race" (Swing State Federal)
- **Before:** Might drop (state politics)
- **After:** Kept (+2 federal "Senate", +1 path)

### 3. "UK Parliament votes on Brexit" (Guardian)
- **Before:** Kept (no filtering)
- **After:** Dropped (requiredUrlIncludes miss `/uk-news/`)

### 4. "What's in the Senate shutdown deal" (Character Encoding)
- **Before:** Displayed as `What&#8217;s`
- **After:** Displayed as `What's` (he.decode at parse)

### 5. "NYC city council approves budget" (CSM Local)
- **Before:** Kept (no filtering)
- **After:** Dropped (-2 for "city council", no federal offset)

---

## Cost Analysis

| Component | Monthly Cost | Notes |
|-----------|-------------|-------|
| Database column (JSONB) | $0 | Minimal storage |
| Rule-based scoring | $0 | ~0.1ms per article, no API calls |
| `he` package | $0 | Local npm package |
| Optional AI tie-breaker | $0.01 | Only for score==0 items (deferred) |
| **Total** | **$0/month** | Well under $50 budget |

**Performance Impact:**
- URL gate check: <0.01ms
- Regex matching: 0.1ms per article
- Total latency: <0.5ms per article (negligible)

---

## Optional: AI Tie-Breaker (Phase 2)

**For borderline articles (score == 0):**

```javascript
async function aiTieBreaker(title, summary) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `Is this about Trump or US federal government? YES/NO:\n"${title}"`
    }],
    max_tokens: 3,
    temperature: 0
  });
  return response.choices[0].message.content.toUpperCase().includes('YES');
}

// In shouldKeepItem:
if (result.score === 0) {
  const isRelevant = await aiTieBreaker(item.title, item.summary);
  return isRelevant;
}
```

**Cost:** ~500 borderline items/month × 100 tokens × $0.15/1M = **$0.0075/month**

**Decision:** Defer until we see how many articles score exactly 0.

---

## Success Criteria

- ✅ Character encoding fixed (all `&#8217;` → `'`)
- ✅ 35%+ reduction in irrelevant articles
- ✅ <5% false positives (Trump/federal stories kept)
- ✅ Zero new infrastructure costs
- ✅ Drop logs show explainable score breakdown
- ✅ Tunable via SQL without code deploy
- ✅ Feed-specific rules prevent over-filtering

---

## JIRA Updates Required

### TTRC-255 Changes

**Original Scope:**
- Add BBC Politics
- Add Guardian Politics
- Add Economist US Politics

**Revised Scope:**
- ~~Add BBC Politics~~ → **Disable** (no US feed available)
- Add Guardian US Politics (updated URL)
- **NEW:** Add Guardian Trump feed
- **NEW:** Add Politico Trump feed
- Add Economist US Politics (no changes)
- **NEW:** Implement rule-based feed filtering
- **NEW:** Fix character encoding bugs

**Acceptance Criteria (Updated):**
- ✅ 3 new feeds added (Guardian US, Guardian Trump, Politico Trump)
- ✅ 1 feed disabled (BBC Politics)
- ✅ 1 feed updated (Guardian UK → US)
- ✅ `filter_config` column added to `feed_registry`
- ✅ `scorer.js` implemented and integrated
- ✅ Character encoding fixed (`he` package)
- ✅ DROP logs show filtered articles
- ✅ `feed_filter_stats` view created
- ✅ 48h monitoring shows <5% false positives
- ✅ Cost remains $0/month

---

## Files to Create/Modify

### New Files:
1. `scripts/rss/scorer.js` - Rule-based scoring engine
2. `docs/plans/2025-11-12-rss-feed-filtering-plan.md` - This document

### Modified Files:
1. `scripts/rss/fetch_feed.js` - Add filtering integration
2. `package.json` - Add `he` dependency
3. Database: `feed_registry` table (add `filter_config` column)
4. Database: Create `admin.feed_filter_stats` view

---

## Next Steps

1. **This Session:** Create plan document, update TTRC-255 in JIRA
2. **Next Session:** 
   - Implement database changes
   - Create scorer.js
   - Integrate filtering
   - Deploy to TEST
   - Monitor for 48h
3. **After 48h:** Tune keywords, verify success criteria, deploy to PROD

---

**Last Updated:** 2025-11-12  
**Status:** Ready for implementation  
**Owner:** Josh  
**Estimated Total Time:** 90 minutes + 48h monitoring
