# Executive Order Enrichment Worker

**Status**: ✅ Implementation complete, ⏸️ **BLOCKED by TTRC-216 schema migration**

Production-grade worker script for enriching executive orders with AI-generated 4-part analysis.

## ⚠️ BLOCKER: Schema Migration Required

**The worker is complete but cannot run until TTRC-216 schema migration is applied.**

### Issue
Database constraint `executive_orders_severity_check` still uses old enum values.

**Error**:
```
new row for relation "executive_orders" violates check constraint "executive_orders_severity_check"
```

**Root Cause**: The `severity` column CHECK constraint expects old values (likely `low`, `medium`, `high`) but our enrichment uses new values: `critical`, `severe`, `moderate`, `minor`.

### Required Fix
Apply TTRC-216 migration to update the severity constraint:

```sql
-- Drop old constraint
ALTER TABLE executive_orders DROP CONSTRAINT IF EXISTS executive_orders_severity_check;

-- Add new constraint with correct values
ALTER TABLE executive_orders ADD CONSTRAINT executive_orders_severity_check
  CHECK (severity IS NULL OR severity IN ('critical', 'severe', 'moderate', 'minor'));
```

**Once schema is fixed, worker will be ready to run immediately.**

---

## Features

- ✅ **Idempotency**: Skip already-enriched EOs (based on `eo.id` + `prompt_version`)
- ✅ **Retry Logic**: 3 attempts with exponential backoff (5s, 20s, 60s)
- ✅ **Rate Limiting**: TokenBucket (10 requests/min) to prevent OpenAI rate limits
- ✅ **Cost Tracking**: Logs every API call to `eo_enrichment_costs` table
- ✅ **Daily Cap**: $5/day hard limit with dynamic guard (3× trailing 7-day average)
- ✅ **Dead-Letter Queue**: Failed enrichments logged to `eo_enrichment_errors`
- ✅ **Validation**: Word counts (100-200 per section), action tier rules, JSON schema
- ✅ **Timeout Handling**: 60-second timeout per OpenAI request

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ enrich-executive-orders.js                               │
│                                                          │
│  ┌──────────────────┐        ┌────────────────────┐    │
│  │ TokenBucket      │        │ EOEnrichmentWorker │    │
│  │ Rate Limiter     │◄───────│                    │    │
│  │ (10 req/min)     │        │ - enrichBatch()    │    │
│  └──────────────────┘        │ - enrichWithRetry()│    │
│                              │ - validateEnrichment()   │
│                              └────────────────────┘    │
│                                       │                 │
│                                       ▼                 │
│                              ┌────────────────────┐    │
│                              │ OpenAI API          │    │
│                              │ (gpt-4o-mini)      │    │
│                              │ $0.007-0.020/EO    │    │
│                              └────────────────────┘    │
│                                       │                 │
│                                       ▼                 │
│                              ┌────────────────────┐    │
│                              │ Supabase DB        │    │
│                              │ - executive_orders │    │
│                              │ - eo_enrichment_costs   │
│                              │ - eo_enrichment_errors  │
│                              └────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## Usage

### Prerequisites
1. **Apply TTRC-216 schema migration** (see BLOCKER section above)
2. Environment variables in `.env`:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   OPENAI_API_KEY=sk-...
   ```

### Run Enrichment

```bash
# Enrich 5 EOs (default)
node scripts/enrichment/enrich-executive-orders.js

# Enrich 20 EOs
node scripts/enrichment/enrich-executive-orders.js 20

# Full backfill (all 190 EOs)
node scripts/enrichment/enrich-executive-orders.js 190
```

### Expected Output

```
🔍 Executive Order Enrichment Worker
=====================================
Batch size: 5
Prompt version: v1

💰 Cost check:
   Today: $0.0000
   Dynamic cap: $0.5000
   Remaining: $0.5000

📋 Found 5 EOs to enrich

🤖 Enriching EO 14333: Declaring a Crime Emergency...
✅ Enriched EO 14333 (1127 tokens, $0.0091)

🤖 Enriching EO 14334: Further Modifying Reciprocal Tariff Rates...
✅ Enriched EO 14334 (1089 tokens, $0.0087)

📊 Enrichment Summary:
   Successful: 5
   Failed: 0

💰 Cost (24 hours):
   Total: $0.0438
   Daily cap: $5.00
   Remaining: $4.9562
```

## Cost Estimates

### Per-EO Cost
- **Input tokens**: 800-1,200 (EO title + summary + prompt)
- **Output tokens**: 700-1,200 (4 sections × ~150 words + metadata)
- **Total cost**: $0.007-0.020 per EO

### Batch Costs
| Batch Size | Est. Cost | Duration @ 10/min |
|------------|-----------|-------------------|
| 5 EOs      | $0.04-0.10 | 30 seconds       |
| 20 EOs     | $0.14-0.40 | 2 minutes        |
| 190 EOs    | $1.33-3.80 | 19 minutes       |

### Monthly Ongoing
- **New EOs**: ~8-10 per month
- **Est. cost**: $0.06-0.20/month

## Database Tables

### executive_orders (enrichment fields)
```sql
-- 4-part analysis
section_what_they_say TEXT NOT NULL DEFAULT ''
section_what_it_means TEXT NOT NULL DEFAULT ''
section_reality_check TEXT NOT NULL DEFAULT ''
section_why_it_matters TEXT NOT NULL DEFAULT ''

-- Metadata
category eo_category NOT NULL  -- 10 EO-specific categories
severity TEXT CHECK (severity IN ('critical', 'severe', 'moderate', 'minor'))
regions TEXT[] NOT NULL DEFAULT '{}'
policy_areas TEXT[] NOT NULL DEFAULT '{}'
affected_agencies TEXT[] NOT NULL DEFAULT '{}'

-- Action framework
action_tier TEXT CHECK (action_tier IN ('direct', 'systemic', 'tracking'))
action_confidence SMALLINT CHECK (action_confidence BETWEEN 0 AND 10)
action_reasoning TEXT NOT NULL DEFAULT ''
action_section JSONB NOT NULL DEFAULT '{}'

-- Tracking
enriched_at TIMESTAMPTZ
prompt_version TEXT DEFAULT 'v1'
```

### eo_enrichment_costs
Tracks per-enrichment costs for budget monitoring.

```sql
id BIGSERIAL PRIMARY KEY
eo_id TEXT NOT NULL
input_tokens INT
output_tokens INT
usd_estimate NUMERIC(10,6)
model TEXT  -- e.g., 'gpt-4o-mini'
prompt_version TEXT
created_at TIMESTAMPTZ DEFAULT NOW()
```

### eo_enrichment_errors
Dead-letter queue for failed enrichments.

```sql
id BIGSERIAL PRIMARY KEY
eo_id TEXT NOT NULL
error_code TEXT
message TEXT
attempt_count INT
created_at TIMESTAMPTZ DEFAULT NOW()
```

## Validation Rules

### Word Count (100-200 words per section)
Each of the 4 sections must be 100-200 words. If OpenAI returns <100 or >200 words, the enrichment fails and retries.

**Enforced sections**:
- `section_what_they_say`
- `section_what_it_means`
- `section_reality_check`
- `section_why_it_matters`

### Category Validation
Must be one of 10 EO-specific categories:
- `immigration_border`
- `environment_energy`
- `health_care`
- `education`
- `justice_civil_rights_voting`
- `natsec_foreign`
- `economy_jobs_taxes`
- `technology_data_privacy`
- `infra_housing_transport`
- `gov_ops_workforce`

### Action Tier Validation

**Tier 1 (DIRECT)**:
- Requires ≥2 specific actions
- At least 1 action must have a URL or phone number
- `action_section` must have valid structure

**Tier 2 (SYSTEMIC)**:
- Focus on long-term organizing/advocacy
- `action_section` can have multiple actions

**Tier 3 (TRACKING)**:
- No actions available
- `action_section` must be `null` or empty

## Error Handling

### Retry Logic
Failed enrichments retry 3 times with exponential backoff:
1. **Attempt 1**: Immediate
2. **Attempt 2**: After 5 seconds
3. **Attempt 3**: After 20 seconds
4. **Attempt 4**: After 60 seconds

### Dead Letter Queue
After 3 failed attempts, errors are logged to `eo_enrichment_errors`:
```sql
SELECT * FROM eo_enrichment_errors
ORDER BY created_at DESC
LIMIT 10;
```

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `executive_orders_severity_check` | Schema not updated | Apply TTRC-216 migration |
| `section_what_it_means must be 100-160 words` | OpenAI returned short section | Prompt emphasizes word count (should retry) |
| `Tier 1 (direct) requires ≥1 URL` | Missing contact info | OpenAI will downgrade to Tier 2 on retry |
| `Daily cap exceeded` | Spent >$5 today | Wait until tomorrow or increase cap |

## Safety Features

### Daily Cost Cap
- **Static cap**: $5.00/day
- **Dynamic cap**: min($5, 3× trailing 7-day average)
- **Minimum cap**: $0.50 (prevents blocking if no recent spending)

**Cap check runs BEFORE each batch**. If cap exceeded, script exits immediately.

### Rate Limiting
TokenBucket algorithm ensures smooth 10 requests/minute:
- **Capacity**: 10 tokens
- **Refill rate**: 10 tokens/minute
- **Behavior**: Wait if bucket empty, don't spam API

### Idempotency
Each enrichment is keyed by `eo.id + prompt_version`. If an EO is already enriched at the current prompt version, it's skipped.

**Prompt version bump**: When you improve the prompt significantly, increment `PROMPT_VERSION` from 'v1' to 'v2'. This triggers re-enrichment of all EOs.

## Monitoring

### Check Enrichment Status
```sql
-- Count unenriched EOs
SELECT COUNT(*) FROM executive_orders
WHERE enriched_at IS NULL OR prompt_version != 'v1';

-- Check recent enrichments
SELECT order_number, enriched_at, prompt_version
FROM executive_orders
WHERE enriched_at > NOW() - INTERVAL '24 hours'
ORDER BY enriched_at DESC;
```

### Check Costs
```sql
-- Today's spending
SELECT SUM(usd_estimate) as total_usd, COUNT(*) as enrichments
FROM eo_enrichment_costs
WHERE created_at >= CURRENT_DATE;

-- Last 30 days
SELECT SUM(usd_estimate) as total_usd, COUNT(*) as enrichments
FROM eo_enrichment_costs
WHERE created_at >= NOW() - INTERVAL '30 days';

-- Per-EO cost breakdown
SELECT eo_id, input_tokens, output_tokens, usd_estimate, created_at
FROM eo_enrichment_costs
ORDER BY created_at DESC
LIMIT 20;
```

### Check Errors
```sql
-- Recent errors
SELECT eo_id, error_code, message, attempt_count, created_at
FROM eo_enrichment_errors
ORDER BY created_at DESC
LIMIT 20;

-- Error frequency by code
SELECT error_code, COUNT(*) as count
FROM eo_enrichment_errors
GROUP BY error_code
ORDER BY count DESC;
```

## Troubleshooting

### Script won't run - environment variables missing
**Error**: `❌ Missing OPENAI_API_KEY environment variable`

**Fix**: Create `.env` file with required variables:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
OPENAI_API_KEY=sk-...
```

### Database constraint violation
**Error**: `new row for relation "executive_orders" violates check constraint`

**Fix**: Apply TTRC-216 schema migration (see BLOCKER section above)

### All enrichments failing validation
**Error**: `section_what_it_means must be 100-160 words (got 94)`

**Diagnosis**: OpenAI not following word count instructions

**Fix**:
1. Check prompt in `prompts.js` - ensure "MUST be 100-160 words" is emphasized
2. Increase `temperature` from 0.7 to 0.8 for more verbose responses
3. Or relax validation to 90-170 words if consistently getting 94-99 words

### High cost per EO (>$0.030)
**Diagnosis**: Token usage higher than expected

**Fix**:
1. Check `eo.summary` - if very long, trim before enrichment
2. Reduce `max_tokens` from 4000 to 3000
3. Use shorter EO descriptions in payload

### Rate limit errors from OpenAI
**Error**: `429 Too Many Requests`

**Fix**: Rate limiter should prevent this, but if it occurs:
1. Reduce rate from 10/min to 8/min in `TokenBucket` constructor
2. Check if multiple workers are running simultaneously

## Development

### Testing Changes
Test with a small batch before full backfill:
```bash
# Test with 3 EOs
node scripts/enrichment/enrich-executive-orders.js 3

# Check results
node -e "
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await supabase
  .from('executive_orders')
  .select('order_number, enriched_at, prompt_version')
  .not('enriched_at', 'is', null)
  .order('enriched_at', { ascending: false })
  .limit(5);
console.table(data);
"
```

### Dry Run Mode
To test validation without calling OpenAI, add a `--dry-run` flag (not implemented yet, but recommended for future).

### Prompt Iteration
1. Edit `scripts/enrichment/prompts.js`
2. Increment `PROMPT_VERSION` in `enrich-executive-orders.js`
3. Test with 5 EOs
4. If quality improved, run full backfill

## Files

```
scripts/enrichment/
├── enrich-executive-orders.js  # Main worker script
├── prompts.js                  # EO enrichment prompt (also used by stories)
└── README.md                   # This file
```

## Support

**Issues**: Create JIRA ticket in TTRC project
**Questions**: Ask Josh (Product Manager)
**Logs**: Check `eo_enrichment_errors` table for dead letters

---

**Version**: 1.0.0
**Created**: 2025-10-12
**Last Updated**: 2025-10-12
**Status**: ✅ Implementation complete, ⏸️ **BLOCKED by TTRC-216**
