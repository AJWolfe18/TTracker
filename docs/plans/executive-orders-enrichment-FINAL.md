# Executive Orders Enrichment - FINAL Implementation Plan

**Created:** 2025-10-12
**Status:** Ready for Implementation
**Epic:** TTRC-16 (Executive Orders Tracker)
**Owner:** Josh Wolfe

---

## 🎯 Executive Summary

**Goal:** Transform Executive Orders tracking from basic metadata collection into comprehensive 4-part editorial analysis with action framework.

**Key Decisions:**
- ✅ 10 EO-specific categories (separate from Stories' 11 categories)
- ✅ 4-part analysis structure (What They Say, What It Means, Reality Check, Why It Matters)
- ✅ 3-tier action framework (direct, systemic, tracking)
- ✅ Dedicated `/executive-orders` page with filters
- ✅ One-time enrichment per EO (not daily)
- ✅ Production-grade worker with idempotency, retries, validation

**Cost:** $2-6 one-time backfill + $0.10-0.30/month ongoing
**Timeline:** 3 weeks (Backend → Frontend → Integration)
**Safety:** $5/day pipeline cap, 3-strike halt, dead-letter logging

---

## 📊 Final Cost & Safeguards

### Per-EO Costs
- **Estimate:** $0.007-$0.020 (0.7-2.0¢) per EO
- **Tokens:** 800-1,200 input + 700-1,200 output
- **Model:** gpt-4o-mini

### One-Time Backfill (~190 EOs)
- **Base cost:** $1.33-3.80
- **Retry buffer (50%):** +$0.67-1.90
- **Total:** $2-6

### Ongoing Monthly (8-10 EOs)
- **Total:** $0.10-$0.30/month

### Safety Caps
- **EO pipeline daily cap:** $5/day (pipeline-scoped, not global)
- **Global project cap:** $50/month across all jobs
- **Dynamic guard:** `min($5, 3 × trailing 7-day average)`
- **Auto-halt:** Stop after 3 consecutive failures OR daily cap hit
- **Manual resume:** Required after auto-halt

### Telemetry
- **Track per call:** input_tokens, output_tokens, usd_estimate, model, prompt_version
- **Table:** `eo_enrichment_costs`
- **Admin dashboard:** Show 24-hour and 30-day totals
- **Alerts:** Email when >$4/day or >$0.50/month

---

## 🔧 Worker Reliability (Production-Grade)

### Idempotency
- **Key:** `eo.id + prompt_version`
- **Check:** Skip if already enriched at current version
- **Benefit:** Prevents duplicate charges, allows safe re-runs

### Retries with Exponential Backoff
- **Attempts:** 3 total
- **Delays:** 5s, 20s, 60s
- **Timeout:** 30-60s per request
- **On final failure:** Log to `eo_enrichment_errors` table

### Rate Limiting
- **Method:** Token bucket (NOT sleep loops)
- **Rate:** ~10 requests/minute
- **Buffer:** 10 tokens, refills at 10/min
- **Benefit:** Smooth traffic, prevents rate limit errors

### Dead Letters
```sql
-- On final failure, insert:
INSERT INTO eo_enrichment_errors (eo_id, error_code, message, attempt_count)
VALUES ('14296', 'OPENAI_TIMEOUT', 'Request timeout after 60s', 3);
```

### Write-Once Protection
- **Trigger:** Prevents `enriched_at` updates unless `prompt_version` increases
- **Benefit:** Prevents accidental re-enrichment costs

### Validation Guards
- **Category:** Must be in `eo_category` enum (10 values)
- **Severity:** Must be in `[critical, severe, moderate, minor]`
- **Word counts:** 100-160 words per section (enforced)
- **Action section:** JSON schema validation
  - Tier 1 requires ≥1 URL or phone pattern
  - Tier 3 requires empty actions array
- **Arrays:** NOT NULL defaults (`'{}'` for empty)

---

## 📂 10 Final EO Categories

| Display Name | Backend Slug | Description |
|--------------|--------------|-------------|
| Immigration & Border | `immigration_border` | Visas, asylum, border rules, enforcement |
| Environment & Energy | `environment_energy` | Climate, pollution, public lands, power/fuel |
| Health Care | `health_care` | Medicare/Medicaid, insurance rules, public health |
| Education | `education` | K-12, higher ed, student loans, school rules |
| Justice, Civil Rights & Voting | `justice_civil_rights_voting` | DOJ/policing, courts, constitutional rights, elections |
| National Security & Foreign Policy | `natsec_foreign` | Military, intel, alliances, sanctions, wars |
| Economy, Jobs & Taxes | `economy_jobs_taxes` | Taxes, jobs, banking, prices; includes tariffs/export controls |
| Technology & Data Privacy | `technology_data_privacy` | Cybersecurity, AI, surveillance, privacy rules |
| Infrastructure, Housing & Transportation | `infra_housing_transport` | Roads, transit, housing, broadband, permits |
| Government Operations & Workforce | `gov_ops_workforce` | OPM/OMB HR, RIFs/layoffs, procurement, ethics, internal ops |

**Labeling Rules:**
- Pick **ONE primary** category per EO
- **RIFs/layoffs/procurement/ethics** → Government Operations & Workforce
- **Sanctions/alliances/military** → NatSec & Foreign Policy
- **Tariffs/export controls** → Economy, Jobs & Taxes
- **Voting/rights/courts/policing** → Justice, Civil Rights & Voting

**Why Separate from Stories?**
- EOs are policy-focused (Immigration, Healthcare)
- Stories track political events (Scandals, Elections)
- Different user needs and browsing patterns
- Mapping table enables cross-app rollups for dashboards

---

## 🗄️ Database Schema Changes (TTRC-216)

### 1. Create Category Enum
```sql
DO $$ BEGIN
  CREATE TYPE eo_category AS ENUM (
    'immigration_border',
    'environment_energy',
    'health_care',
    'education',
    'justice_civil_rights_voting',
    'natsec_foreign',
    'economy_jobs_taxes',
    'technology_data_privacy',
    'infra_housing_transport',
    'gov_ops_workforce'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

### 2. Add Enrichment Fields
```sql
ALTER TABLE executive_orders
  ADD COLUMN IF NOT EXISTS section_what_they_say TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS section_what_it_means TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS section_reality_check TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS section_why_it_matters TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS regions TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS policy_areas TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS affected_agencies TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS action_tier TEXT CHECK (action_tier IN ('direct','systemic','tracking')),
  ADD COLUMN IF NOT EXISTS action_confidence SMALLINT CHECK (action_confidence BETWEEN 0 AND 10),
  ADD COLUMN IF NOT EXISTS action_reasoning TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS action_section JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prompt_version TEXT DEFAULT 'v1';
```

### 3. Create Support Tables
```sql
-- Dead-letter queue
CREATE TABLE IF NOT EXISTS eo_enrichment_errors (
  id BIGSERIAL PRIMARY KEY,
  eo_id TEXT NOT NULL,
  error_code TEXT,
  message TEXT,
  attempt_count INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cost tracking
CREATE TABLE IF NOT EXISTS eo_enrichment_costs (
  id BIGSERIAL PRIMARY KEY,
  eo_id TEXT NOT NULL,
  input_tokens INT,
  output_tokens INT,
  usd_estimate NUMERIC(10,6),
  model TEXT,
  prompt_version TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_eo_costs_date ON eo_enrichment_costs(created_at);
CREATE INDEX IF NOT EXISTS idx_eo_errors_eo_id ON eo_enrichment_errors(eo_id);
```

### 4. Migrate Legacy Categories
```sql
-- Add new column
ALTER TABLE executive_orders ADD COLUMN IF NOT EXISTS category_v2 eo_category;

-- Backfill using mapping
UPDATE executive_orders SET category_v2 =
  CASE category
    WHEN 'immigration' THEN 'immigration_border'::eo_category
    WHEN 'environment' THEN 'environment_energy'::eo_category
    WHEN 'healthcare' THEN 'health_care'::eo_category
    WHEN 'defense' THEN 'natsec_foreign'::eo_category
    WHEN 'trade' THEN 'economy_jobs_taxes'::eo_category
    WHEN 'education' THEN 'education'::eo_category
    WHEN 'judicial' THEN 'justice_civil_rights_voting'::eo_category
    WHEN 'economic' THEN 'economy_jobs_taxes'::eo_category
    WHEN 'regulatory' THEN 'gov_ops_workforce'::eo_category
    WHEN 'government_operations' THEN 'gov_ops_workforce'::eo_category
    ELSE 'gov_ops_workforce'::eo_category
  END
WHERE category_v2 IS NULL;

-- Make required and swap
ALTER TABLE executive_orders ALTER COLUMN category_v2 SET NOT NULL;
ALTER TABLE executive_orders DROP COLUMN IF EXISTS category;
ALTER TABLE executive_orders RENAME COLUMN category_v2 TO category;
```

### 5. Write-Once Trigger
```sql
CREATE OR REPLACE FUNCTION prevent_enriched_at_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.enriched_at IS NOT NULL AND NEW.enriched_at != OLD.enriched_at THEN
    -- Only allow if prompt_version increased
    IF NEW.prompt_version <= OLD.prompt_version THEN
      RAISE EXCEPTION 'enriched_at cannot be updated without prompt_version increase';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lock_enriched_at
  BEFORE UPDATE ON executive_orders
  FOR EACH ROW
  EXECUTE FUNCTION prevent_enriched_at_update();
```

---

## 📝 Enrichment Prompt (TTRC-217)

### Prompt Structure
```javascript
export const EO_ENRICHMENT_PROMPT = `You are a political analyst. Return ONLY valid JSON.

Generate 4-part analysis for this Executive Order:

1. **What They Say** (100-160 words):
   - Official language/framing from the EO
   - MAY include SHORT quoted phrases (cited, <20 words each)
   - Only from: official EO text, Federal Register abstract
   - NO third-party sources

2. **What It Means** (100-160 words):
   - Plain English translation
   - Cut through euphemisms
   - Real-world impact for regular people

3. **Reality Check** (100-160 words):
   - Fact verification
   - Contradictions with official claims
   - Historical precedent

4. **Why It Matters** (100-160 words):
   - Long-term implications
   - Power shifts
   - Who wins/loses

**Metadata (required):**
- category: ONE of [immigration_border, environment_energy, health_care, education, justice_civil_rights_voting, natsec_foreign, economy_jobs_taxes, technology_data_privacy, infra_housing_transport, gov_ops_workforce]
- severity: one of [critical, severe, moderate, minor]
- regions: max 3 strings (e.g. ["Texas", "Border States"] or ["National"])
- policy_areas: max 3 (e.g. ["Immigration", "Civil Rights"])
- affected_agencies: top 3 (e.g. ["DHS", "DOJ", "ICE"])

**Action Framework (3-tier):**

**Tier 1 (DIRECT):** 2-4 specific actions with URLs or phone numbers
- Examples: "Donate to RAICES bond fund" + URL, "Call Congress (202-224-3121)"
- Must have specificity ≥7/10
- Requires at least one URL or phone number

**Tier 2 (SYSTEMIC):** Long-term organizing/advocacy
- When damage done OR no direct path
- Examples: "Vote in 2026", "Support accountability journalism"
- Focus on infrastructure building

**Tier 3 (TRACKING):** No actions available
- Ceremonial orders, internal ops, completed acts
- action_section = null
- UI shows "Tracking only" note

**Quality gates:**
- If <2 specific Tier-1 actions → downgrade to Tier 2
- If action_confidence <7 → downgrade to Tier 2 or 3
- NEVER fabricate URLs or organizations

**Output JSON format:**
{
  "section_what_they_say": "...",
  "section_what_it_means": "...",
  "section_reality_check": "...",
  "section_why_it_matters": "...",
  "category": "...",
  "severity": "...",
  "regions": [...],
  "policy_areas": [...],
  "affected_agencies": [...],
  "action_tier": "direct|systemic|tracking",
  "action_confidence": 0-10,
  "action_reasoning": "brief explanation",
  "action_section": {
    "title": "What We Can Do" | "How We Fight Back",
    "actions": [
      {
        "type": "donate|call|attend|support|organize|vote",
        "description": "specific action",
        "specificity": 0-10,
        "url": "https://..." (optional),
        "deadline": "YYYY-MM-DD" (optional)
      }
    ]
  } | null
}`;

export function buildEOPayload(eo) {
  return `Executive Order ${eo.order_number}: "${eo.title}"

Signed: ${eo.date}
Official Summary: ${eo.summary || 'Not available'}

Analyze this order and provide the 4-part analysis with metadata and action recommendations.`;
}
```

---

## 🔨 Worker Implementation (TTRC-218)

### Core Architecture
```javascript
// scripts/enrichment/enrich-executive-orders.js

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { EO_ENRICHMENT_PROMPT, buildEOPayload } from './prompts.js';
import dotenv from 'dotenv';
dotenv.config();

const PROMPT_VERSION = 'v1';
const DAILY_CAP_USD = 5.00;
const MAX_RETRIES = 3;
const BACKOFF_MS = [5000, 20000, 60000];

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

class TokenBucket {
  constructor(capacity = 10, refillRate = 10) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRate = refillRate; // per minute
    this.lastRefill = Date.now();
  }

  async consume() {
    this.refill();
    if (this.tokens < 1) {
      const waitMs = Math.ceil(60000 / this.refillRate);
      await new Promise(resolve => setTimeout(resolve, waitMs));
      this.refill();
    }
    this.tokens -= 1;
  }

  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 60000;
    const tokensToAdd = elapsed * this.refillRate;
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

class EOEnrichmentWorker {
  constructor() {
    this.rateLimiter = new TokenBucket(10, 10); // 10 req/min
  }

  async enrichBatch(limit = 5) {
    console.log(`\n🔍 Finding up to ${limit} unenriched EOs...\n`);

    // 1. Check daily cap
    await this.checkDailyCap();

    // 2. Get unenriched EOs
    const { data: eos, error } = await supabase
      .from('executive_orders')
      .select('*')
      .is('enriched_at', null)
      .order('date', { ascending: false })
      .limit(limit);

    if (error) throw error;
    if (!eos || eos.length === 0) {
      console.log('✅ No unenriched EOs found\n');
      return;
    }

    console.log(`📋 Found ${eos.length} EOs to enrich\n`);

    // 3. Process each with rate limiting
    for (const eo of eos) {
      await this.rateLimiter.consume();
      await this.enrichWithRetry(eo);
    }

    // 4. Summary
    console.log('\n📊 Enrichment Summary:');
    const { data: costs } = await supabase
      .from('eo_enrichment_costs')
      .select('usd_estimate')
      .gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString());

    const total = costs?.reduce((sum, r) => sum + parseFloat(r.usd_estimate), 0) || 0;
    console.log(`   24h cost: $${total.toFixed(4)}`);
    console.log(`   Daily cap: $${DAILY_CAP_USD}`);
    console.log(`   Remaining: $${(DAILY_CAP_USD - total).toFixed(4)}\n`);
  }

  async enrichWithRetry(eo, attempt = 0) {
    const idempotencyKey = `${eo.id}-${PROMPT_VERSION}`;

    // Skip if already enriched at this version
    if (eo.enriched_at && eo.prompt_version === PROMPT_VERSION) {
      console.log(`✓ Skip ${eo.order_number} - already enriched v${PROMPT_VERSION}`);
      return;
    }

    try {
      console.log(`🤖 Enriching EO ${eo.order_number}...`);

      // Call OpenAI with timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: EO_ENRICHMENT_PROMPT },
          { role: 'user', content: buildEOPayload(eo) }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 4000,
        temperature: 0.7
      }, { signal: controller.signal });

      clearTimeout(timeout);

      // Parse and validate
      const enrichment = JSON.parse(completion.choices[0].message.content);
      this.validateEnrichment(enrichment);

      // Update database
      const { error: updateError } = await supabase
        .from('executive_orders')
        .update({
          ...enrichment,
          enriched_at: new Date().toISOString(),
          prompt_version: PROMPT_VERSION
        })
        .eq('id', eo.id);

      if (updateError) throw updateError;

      // Track cost
      await this.trackCost(eo.id, completion.usage);

      console.log(`✅ Enriched ${eo.order_number} (${completion.usage.total_tokens} tokens)\n`);

    } catch (error) {
      if (attempt < MAX_RETRIES - 1) {
        const backoff = BACKOFF_MS[attempt];
        console.log(`⚠️  Retry ${attempt + 1}/${MAX_RETRIES} after ${backoff}ms: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        return this.enrichWithRetry(eo, attempt + 1);
      } else {
        // Dead letter
        await this.logError(eo.id, error, attempt + 1);
        console.error(`❌ Failed ${eo.order_number} after ${MAX_RETRIES} attempts: ${error.message}\n`);
      }
    }
  }

  validateEnrichment(data) {
    // Required fields
    const required = ['section_what_they_say', 'section_what_it_means',
                     'section_reality_check', 'section_why_it_matters',
                     'category', 'severity', 'action_tier'];

    for (const field of required) {
      if (!data[field]) throw new Error(`Missing required field: ${field}`);
    }

    // Word count validation (100-160 words per section)
    for (const section of ['section_what_they_say', 'section_what_it_means',
                           'section_reality_check', 'section_why_it_matters']) {
      const words = data[section].trim().split(/\s+/).length;
      if (words < 100 || words > 160) {
        throw new Error(`${section} must be 100-160 words (got ${words})`);
      }
    }

    // Tier 1 validation (requires URL or phone)
    if (data.action_tier === 'direct') {
      const actions = data.action_section?.actions || [];
      if (actions.length < 2) {
        throw new Error('Tier 1 requires ≥2 actions');
      }
      const hasValidContact = actions.some(a =>
        a.url || /\d{3}[-\s]?\d{3}[-\s]?\d{4}/.test(a.description)
      );
      if (!hasValidContact) {
        throw new Error('Tier 1 requires ≥1 URL or phone number');
      }
    }

    // Tier 3 validation (no actions)
    if (data.action_tier === 'tracking') {
      if (data.action_section && data.action_section.actions?.length > 0) {
        throw new Error('Tier 3 cannot have actions');
      }
    }
  }

  async checkDailyCap() {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
      .from('eo_enrichment_costs')
      .select('usd_estimate')
      .gte('created_at', `${today}T00:00:00Z`);

    const total = data?.reduce((sum, r) => sum + parseFloat(r.usd_estimate), 0) || 0;

    // Dynamic guard: min($5, 3 × trailing 7-day average)
    const { data: week } = await supabase
      .from('eo_enrichment_costs')
      .select('usd_estimate')
      .gte('created_at', new Date(Date.now() - 7*24*60*60*1000).toISOString());

    const weekTotal = week?.reduce((sum, r) => sum + parseFloat(r.usd_estimate), 0) || 0;
    const weekAvg = weekTotal / 7;
    const dynamicCap = Math.min(DAILY_CAP_USD, weekAvg * 3);

    if (total >= dynamicCap) {
      throw new Error(`Daily cap exceeded: $${total.toFixed(2)} >= $${dynamicCap.toFixed(2)}`);
    }
  }

  async trackCost(eo_id, usage) {
    const inputCost = (usage.prompt_tokens / 1000) * 0.00015;  // gpt-4o-mini input
    const outputCost = (usage.completion_tokens / 1000) * 0.0006; // gpt-4o-mini output

    await supabase.from('eo_enrichment_costs').insert({
      eo_id,
      input_tokens: usage.prompt_tokens,
      output_tokens: usage.completion_tokens,
      usd_estimate: inputCost + outputCost,
      model: 'gpt-4o-mini',
      prompt_version: PROMPT_VERSION
    });
  }

  async logError(eo_id, error, attempts) {
    await supabase.from('eo_enrichment_errors').insert({
      eo_id,
      error_code: error.code || 'UNKNOWN',
      message: error.message,
      attempt_count: attempts
    });
  }
}

// Main execution
async function main() {
  const worker = new EOEnrichmentWorker();

  // Get batch size from args or default to 5
  const batchSize = parseInt(process.argv[2]) || 5;

  await worker.enrichBatch(batchSize);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

**Usage:**
```bash
# Enrich 5 EOs
node scripts/enrichment/enrich-executive-orders.js

# Enrich 20 EOs
node scripts/enrichment/enrich-executive-orders.js 20

# Full backfill (all 190)
node scripts/enrichment/enrich-executive-orders.js 190
```

---

## 📅 Implementation Timeline

### Week 1: Backend Foundation

**Day 1 (3 hours) - TTRC-216: Schema**
- Create eo_category enum with 10 values
- Add enrichment fields with NOT NULL defaults
- Create eo_enrichment_errors table
- Create eo_enrichment_costs table
- Add write-once trigger for enriched_at
- Backfill legacy categories
- Test sample INSERT

**Day 1-2 (3 hours) - TTRC-217: Prompt**
- Write EO_ENRICHMENT_PROMPT with word limits
- Add buildEOPayload() helper
- Document validation rules
- Test with 2 sample EOs manually
- Verify JSON output format

**Day 2-3 (8 hours) - TTRC-218: Worker**
- Implement TokenBucket rate limiter
- Add idempotency + prompt versioning
- Add retry with exponential backoff
- Add timeout handling (60s)
- Implement daily cap check
- Add cost tracking to table
- Add dead-letter logging
- Add validation checks (word count, tier rules)
- Test with 5 sample EOs

**Day 4-5 (4 hours) - TTRC-219: Backfill**
- Sample test 5 EOs (verify cost $0.007-0.020 each)
- Adjust prompt if needed
- Run full backfill (190 EOs, rate-limited to 10/min)
- Monitor dead-letter queue
- QA 50 random EOs (26% sample)
- Generate quality report
- Document any manual fixes needed

**Milestone:** All 190 EOs enriched, validated, cost within $2-6

### Week 2: Frontend Core

**Day 1-2 (9 hours) - TTRC-220 & 221: Page + Card**
- Create `/executive-orders` route
- Build EO listing page with pagination
- Create EOCard component (collapsed/expanded states)
- Display 4-part analysis with icons
- Show action section (conditional on tier)
- Mobile responsive
- Loading/error states

**Day 3-4 (8 hours) - TTRC-222: Filters**
- Build FilterBar component
- Implement 6 filter types:
  - Category (single-select dropdown)
  - Severity (toggle pills)
  - Date range (presets + custom)
  - Agencies (multi-select with search)
  - Regions (multi-select)
  - Search (order number, title)
- URL state management
- "Clear all" button
- Mobile drawer for filters

**Day 5 (2 hours) - Testing & Polish**
- Test filter combinations
- QA card expand/collapse
- Mobile testing
- Performance check
- Fix any bugs

**Milestone:** Working /executive-orders page with filters and rich display

### Week 3: Integration & Launch

**Day 1 (3 hours) - TTRC-223: Pipeline Integration**
- Modify collection script (executive-orders-tracker-supabase.js)
- Add automatic enrichment after save
- Error handling (don't block collection)
- Update GitHub Action
- Test locally

**Day 2 (2 hours) - TTRC-224: Navigation**
- Add "Executive Orders" link to main nav
- Active state highlighting
- Mobile menu update
- Optional: Critical EO count badge
- Final testing

**Day 3-5 (6 hours) - Deployment & Monitoring**
- Deploy to TEST, monitor
- Cherry-pick to PROD
- Monitor daily job
- Track cost telemetry
- Bug fixes as needed
- User feedback

**Milestone:** Live on production with daily enrichment

**Total Duration:** 3 weeks (15 work days)

---

## ✅ Pre-Flight Checklist

### Schema Ready
- [ ] eo_category enum created with 10 values
- [ ] All enrichment fields added with NOT NULL defaults
- [ ] eo_enrichment_errors table exists
- [ ] eo_enrichment_costs table exists
- [ ] Write-once trigger on enriched_at working
- [ ] Legacy categories migrated to new enum
- [ ] Test INSERT with all new fields succeeds

### Worker Ready
- [ ] TokenBucket rate limiter implemented (10 req/min)
- [ ] Idempotency check (eo.id + prompt_version)
- [ ] Exponential backoff retry (3 attempts: 5s, 20s, 60s)
- [ ] Timeout handling (60s max)
- [ ] Daily cap check ($5 or 3× 7-day avg)
- [ ] Cost tracking writes to eo_enrichment_costs
- [ ] Dead-letter writes to eo_enrichment_errors
- [ ] Validation checks all required fields
- [ ] Word count validation (100-160 per section)
- [ ] Action tier validation (Tier 1 requires URL/phone)

### Prompt Ready
- [ ] EO_ENRICHMENT_PROMPT includes 100-160 word limits
- [ ] Category list = final 10 categories
- [ ] Quoting rules explicit (official sources only)
- [ ] Action tier requirements documented
- [ ] Validation examples included

### Monitoring Ready
- [ ] Admin dashboard shows 24h + 30d cost totals
- [ ] Alert set for >$4/day
- [ ] Alert set for >$0.50/month
- [ ] Dead-letter queue monitoring
- [ ] Can view eo_enrichment_errors in admin

### Test Results
- [ ] 5 sample EOs enriched successfully
- [ ] Cost per EO: $0.007-0.020 ✓
- [ ] All 4 sections 100-160 words ✓
- [ ] Action validation working ✓
- [ ] No invalid JSON ✓
- [ ] Rate limiter prevents >10 req/min ✓

---

## 📊 Success Metrics

### Technical Metrics
| Metric | Target | How to Measure |
|--------|--------|----------------|
| Enrichment success rate (first try) | ≥95% | Count(enriched) / Count(total) |
| p95 enrichment latency | ≤10s | OpenAI API response time |
| Invalid JSON responses | 0 | Count(JSON parse errors) |
| Daily cost | <$5 | SUM(eo_enrichment_costs.usd_estimate WHERE DATE(created_at) = today) |
| Monthly cost | $0.10-0.30 | SUM(eo_enrichment_costs.usd_estimate WHERE created_at >= NOW() - INTERVAL '30 days') |
| Dead-letter rate | <5% | Count(eo_enrichment_errors) / Count(total enrichments) |

### Content Quality Metrics
| Metric | Target | How to Measure |
|--------|--------|----------------|
| All 4 sections ≥100 words | >95% | Manual QA sample (50 EOs) |
| Action sections (Tier 1/2) with ≥2 items | ≥80% | `SELECT COUNT(*) FROM executive_orders WHERE action_tier IN ('direct','systemic') AND jsonb_array_length(action_section->'actions') >= 2` |
| Valid URLs/phone patterns | 100% | Validation check in worker |
| Category correctness | >95% | Manual QA sample (50 EOs) |
| Action confidence scores | >7/10 avg | `SELECT AVG(action_confidence) FROM executive_orders WHERE action_tier IN ('direct','systemic')` |

### Operational Metrics
| Metric | Target | How to Measure |
|--------|--------|----------------|
| Manual edits per 30 EOs | <5% | Track admin edits in logs |
| Cost cap triggers | 0 | Count daily cap exceptions |
| Re-enrichment runs | 0 | Count prompt_version changes |

---

## 🚨 Rollback Procedures

### If Enrichment Quality Poor (<80% pass QA)
**Trigger:** Manual QA of 50 EOs shows <80% acceptable quality

**Actions:**
1. Stop worker immediately
2. Clear enrichment fields:
   ```sql
   UPDATE executive_orders
   SET section_what_they_say = '',
       section_what_it_means = '',
       section_reality_check = '',
       section_why_it_matters = '',
       action_tier = NULL,
       action_section = '{}',
       enriched_at = NULL,
       prompt_version = NULL
   WHERE prompt_version = 'v1';
   ```
3. Refine prompt based on QA findings
4. Re-test with 10 samples
5. If passing (≥80%), resume with `prompt_version = 'v2'`

**Time to Rollback:** 1 hour

---

### If Daily Cap Hit Repeatedly (>3 consecutive days)
**Trigger:** Daily cap exceeded 3+ days in a row

**Actions:**
1. Review eo_enrichment_costs table:
   ```sql
   SELECT DATE(created_at), COUNT(*),
          SUM(input_tokens), SUM(output_tokens), SUM(usd_estimate)
   FROM eo_enrichment_costs
   WHERE created_at >= NOW() - INTERVAL '7 days'
   GROUP BY DATE(created_at)
   ORDER BY 1 DESC;
   ```
2. Identify cause:
   - Token bloat? → Truncate prompts, reduce context
   - High volume? → Expected for backfill, temporary
   - Model cost increase? → Check OpenAI pricing changes
3. Solutions:
   - Consider gpt-3.5-turbo (cheaper but lower quality)
   - Adjust cap upward if justified by business value
   - Add manual approval gate for large batches
4. Update `DAILY_CAP_USD` constant if needed

**Time to Rollback:** Immediate (adjust constant)

---

### If Dead-Letter Rate >10%
**Trigger:** >10% of enrichment attempts fail after all retries

**Actions:**
1. Query error patterns:
   ```sql
   SELECT error_code, COUNT(*),
          string_agg(DISTINCT message, ' | ') as sample_messages
   FROM eo_enrichment_errors
   WHERE created_at > NOW() - INTERVAL '24 hours'
   GROUP BY error_code
   ORDER BY COUNT(*) DESC;
   ```
2. Common failures and fixes:
   - **OPENAI_TIMEOUT:** Increase timeout to 90s
   - **JSON_PARSE_ERROR:** Improve prompt instructions
   - **RATE_LIMIT:** Reduce to 8 req/min
   - **VALIDATION_ERROR:** Relax word count (90-170 words)
3. Fix root cause in code
4. Re-run failed EOs:
   ```sql
   SELECT DISTINCT eo_id
   FROM eo_enrichment_errors
   WHERE created_at > NOW() - INTERVAL '24 hours';
   ```
5. Update `enriched_at = NULL` for failed EOs to retry

**Time to Rollback:** 2-4 hours (depends on fix complexity)

---

### If Frontend Has Critical Bugs
**Trigger:** User-facing errors, page won't load, console errors

**Actions:**
1. Revert frontend deployment via Netlify
2. Remove navigation link (TTRC-224) temporarily
3. Fix bugs in TEST environment
4. Re-test thoroughly (all browsers, mobile)
5. Re-deploy when stable
6. Re-add navigation link

**Impact:** EO section temporarily unavailable (backend still working, no data loss)

**Time to Rollback:** 30 minutes

---

## 📚 Documentation Requirements

### User Documentation
- [ ] Help guide for EO section usage
- [ ] Filter usage instructions
- [ ] Understanding the 4-part analysis
- [ ] How to use action recommendations

### Developer Documentation
- [ ] Schema documentation (auto-generated from DB)
- [ ] Enrichment worker README
- [ ] API documentation for Supabase queries
- [ ] Deployment guide (how to run migrations)

### Runbooks
- [ ] Daily job monitoring procedures
- [ ] Manual enrichment procedure (if needed)
- [ ] Troubleshooting guide (common errors)
- [ ] Rollback procedures (detailed above)

---

## 🎯 Next Immediate Steps

1. **Review & Approve:** Josh reviews this plan, approves budget and approach
2. **TTRC-216:** Create database migration SQL (schema + tables + trigger)
3. **TTRC-217:** Write EO_ENRICHMENT_PROMPT with all constraints
4. **TTRC-218:** Implement worker with all safeguards (TokenBucket, retry, validation)
5. **Test:** Run on 5 sample EOs, verify cost $0.035-0.10 total
6. **Approve Backfill:** Josh reviews sample results
7. **TTRC-219:** Run full backfill (190 EOs, ~19 minutes at 10/min)
8. **QA:** Manual review of 50 random EOs
9. **Frontend:** Proceed to TTRC-220-224

**Estimated Time to First Enriched EO:** 1 week after approval

---

## ❓ Open Questions for Approval

### ✅ APPROVED (2025-10-12)

1. **Budget:** ✅ **APPROVED** - Proceed with $2-6 one-time + $0.10-0.30/month

2. **Daily cap:** ✅ **APPROVED** - $5/day with dynamic guard is good. Plenty of headroom.

3. **Prompt version UI:** ❌ **SKIP FOR NOW** - Don't surface to users yet

4. **Manual re-enrich:** ✅ **YES, BUT SEPARATE** - Move to Admin Dashboard card with proper UX and audit trail

5. **Action URL validation:** ✅ **APPROVED AS-IS** - Tier 1 requires URL/phone validation (not too strict)

6. **QA sample size:** ✅ **APPROVED** - 50 EOs (26%) is ample for initial pass

---

**Document Status:** ✅ FINAL - Ready for Implementation
**Next Review:** After TTRC-219 (backfill completion)
**Last Updated:** 2025-10-12
