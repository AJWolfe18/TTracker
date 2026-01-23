# ADO-85: SCOTUS Enrichment Script Plan

**Created:** 2026-01-20
**Updated:** 2026-01-22
**Status:** ✅ IMPLEMENTED - Full Opinion Architecture Complete
**ADO:** [ADO-85](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/85) / [ADO-280](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/280) (CLOSED) / [ADO-283](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/283) (Active)

---

## 🚨 Current Status

### ✅ ADO-280 Implementation Complete (2026-01-22)

**Files Created/Modified:**
- `migrations/067_scotus_two_pass.sql` - Schema additions (applied to TEST)
- `scripts/enrichment/scotus-fact-extraction.js` - Pass 0 + Pass 1 logic + validator
- `scripts/enrichment/scotus-drift-validation.js` - Pass 2 drift checker
- `scripts/enrichment/scotus-gpt-prompt.js` - Added Pass 2 prompts
- `scripts/scotus/enrich-scotus.js` - Rewrote with two-pass pipeline

**Bug Fixes Applied:**
- `validatePass1()` cap logic: moved cap to AFTER validation failures check (medium confidence now allows enrichment)

**Test Results:**
| Case | Pass 0 | Pass 1 | Pass 2 | Result |
|------|--------|--------|--------|--------|
| FDA v. Alliance | ❌ FAILED (481 chars, no anchors) | - | - | Correctly flagged |
| Starbucks v. McKinney | ✅ (1158 chars) | ✅ medium | ✅ no drift | Enriched, needs review |
| Connelly | ❌ FAILED (truncated syllabus) | - | - | Correctly flagged |

**Architecture Working As Designed:**
- Pass 0 gates insufficient source text (prevents hallucination)
- Pass 1 extracts facts with consensus check
- Pass 2 applies editorial with drift validation
- Confidence-based publishing: high→public, medium→review

### Previous Issue (Resolved)
**GPT hallucination when source material is insufficient:**

| Case | Source Quality | GPT Said | Reality |
|------|----------------|----------|---------|
| FDA v. Alliance | 481 chars (header only) | "Pharma wins, loophole opened" | Standing dismissal - no merits ruling |
| Starbucks v. McKinney | Full syllabus | "Workers win temporarily" | Made injunctions *harder* for NLRB |
| Connelly v. United States | Truncated syllabus | "Corps vs small business" | Estate tax valuation case |

**Root cause:** Single-pass enrichment conflates fact extraction with editorial framing. **FIXED by two-pass architecture.**

### Next Steps
1. ~~**[ADO-280](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/280)** - Two-pass architecture~~ ✅ DONE
2. ~~**[ADO-283](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/283)** - Full Opinion Architecture~~ ✅ CODE COMPLETE (2026-01-22)
   - Migration 069 applied to TEST
   - Code reviewed, type fix (UUID→BIGINT) and error handling fixed
   - **Next:** Test with `COURTLISTENER_API_TOKEN` to verify full flow
3. **Bulk enrichment** - Can now run safely with two-pass architecture + full opinions

---

## 🚨 ARCHITECTURAL CHANGE: Full Opinion Input (2026-01-22)

### Quick Reference: Files to Modify

| File | Lines | Change |
|------|-------|--------|
| `migrations/068_scotus_full_opinion.sql` | NEW | Create `scotus_opinions` table + CHECK + RLS + backfill NULLs |
| `scripts/scotus/opinion-utils.js` | NEW | Shared `buildCanonicalOpinionText()` (import in fetch + backfill) |
| `scripts/scotus/fetch-cases.js` | ~245, ~400-440, ~456-470 | Import canonical builder, upsert to new table, conditional version update |
| `scripts/enrichment/scotus-fact-extraction.js` | ~79, ~126, ~145, ~259, ~691 | DB_COLUMNS, thresholds, getSourceText (windowing), getCasesToEnrich (!left JOIN) |
| `scripts/enrichment/scotus-gpt-prompt.js` | ~50-80 | Update FACT_EXTRACTION_PROMPT for section headers |
| `scripts/scotus/backfill-opinions.js` | NEW | Full implementation provided in Section 7 |

### Problem Discovery

Investigation revealed that our syllabus extraction approach is fundamentally flawed:

| Issue | Finding |
|-------|---------|
| CourtListener `syllabus` field | **ALWAYS EMPTY** for SCOTUS clusters |
| CourtListener `summary` field | **ALWAYS EMPTY** for SCOTUS clusters |
| CourtListener `headnotes` field | **ALWAYS EMPTY** for SCOTUS clusters |
| Our regex extraction | Fragile - misses edge cases, causes Pass 0 failures |
| Oyez API `description` | Only ~200 chars - not enough context |

**The syllabus exists in `plain_text`** but extracting it via regex is unreliable.

### Solution: Send Full Opinion

**Decision:** Send the complete `opinion.plain_text` to GPT instead of extracted syllabus.

### Data Analysis (2024 Term)

| Metric | Size | Tokens | Cost (GPT-4o-mini) |
|--------|------|--------|-------------------|
| Minimum | 3,806 chars | ~950 | $0.0001 |
| **Median** | 38,000 chars | ~9,500 | $0.0014 |
| **Average** | 40,000 chars | ~10,000 | $0.0015 |
| 90th percentile | 82,000 chars | ~20,500 | $0.0031 |
| Maximum | 142,000 chars | ~35,000 | $0.0053 |

**Full term cost (50 cases at average): $0.07**

### GPT Quality Testing

| Test Case | Size | Result |
|-----------|------|--------|
| TikTok v. Garland | 68K chars (unanimous) | ✅ Correct vote split, correct "no dissent" |
| Williams v. Reed | 54K chars (5-4 with Thomas dissent) | ✅ Correct vote split, extracted dissent arguments accurately |

**GPT handles full opinions well:**
- Correctly identifies vote splits
- Extracts dissent arguments from end of document
- Doesn't confuse citations to other cases with actual dissents
- Good editorial tone in output

### Why Keep Two-Pass Architecture

Even with full opinions, two-pass is still valuable:

| Reason | Explanation |
|--------|-------------|
| Fact validation | Pass 1 locks facts before editorial creativity |
| Drift detection | Can catch when Pass 2 contradicts Pass 1 facts |
| Confidence gating | Low-confidence cases flagged before wasting Pass 2 tokens |
| Cost efficiency | Pass 2 only receives extracted facts (~500 tokens), not full opinion |

**Pass 1:** Full opinion (~10K tokens) → Extracted facts (~500 tokens)
**Pass 2:** Extracted facts (~500 tokens) → Editorial output (~500 tokens)

Two-pass is actually MORE efficient for long documents because Pass 2 works with compressed facts.

### Implementation Changes Required

> **⚠️ ARCHITECTURAL DECISIONS** (from code review)
>
> 1. **Separate table for full opinions** - Prevents accidental `SELECT *` pulling 40-140K per row
> 2. **Multi-opinion canonical text** - CourtListener clusters have separate majority/concurrence/dissent docs
> 3. **Token windowing** - First + Last N chars strategy for outliers (>100K chars)
> 4. **Structural validation** - Check for SCOTUS markers, not just length
> 5. **In-place backfill** - Don't delete+refetch; update existing rows

---

#### 1. Schema Changes

**File:** `migrations/068_scotus_full_opinion.sql`

```sql
-- Migration 068: Separate table for full opinion text
-- Rationale: Prevents accidental egress from SELECT * on scotus_cases

-- Create separate table for full opinion storage
-- NOTE: No source_data_version here - if row exists, it's v2 by definition
-- Single source of truth: scotus_cases.source_data_version
CREATE TABLE IF NOT EXISTS scotus_opinions (
  case_id UUID PRIMARY KEY REFERENCES scotus_cases(id) ON DELETE CASCADE,
  opinion_full_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,  -- sha256 hex, enables skip-if-unchanged + change detection
  char_count INTEGER GENERATED ALWAYS AS (LENGTH(opinion_full_text)) STORED,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add version tracking to main table (lightweight)
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS source_data_version TEXT DEFAULT 'v1-syllabus';

-- CRITICAL: Backfill existing NULLs BEFORE adding CHECK constraint
-- (Otherwise constraint fails on existing rows)
UPDATE scotus_cases
SET source_data_version = 'v1-syllabus'
WHERE source_data_version IS NULL;

-- IDEMPOTENT: Drop constraint if exists, then recreate
-- (Plain ADD CONSTRAINT fails if already exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_source_data_version'
  ) THEN
    ALTER TABLE scotus_cases DROP CONSTRAINT chk_source_data_version;
  END IF;
END $$;

ALTER TABLE scotus_cases
ADD CONSTRAINT chk_source_data_version
CHECK (source_data_version IN ('v1-syllabus', 'v2-full-opinion'));

-- NOTE: No index needed on scotus_opinions(case_id) - PRIMARY KEY already creates one

-- SECURITY: Enable RLS and do NOT add public read policies
-- service_role bypasses RLS for ingestion/enrichment jobs
ALTER TABLE scotus_opinions ENABLE ROW LEVEL SECURITY;

-- No policies = no anon/authenticated access (only service_role can read/write)

COMMENT ON TABLE scotus_opinions IS
'Stores full opinion text separately to prevent accidental egress. Job-read-only. RLS enabled, no public policies.';
```

**Why separate table:**
- UI queries on `scotus_cases` can't accidentally pull 40-140K per row
- Enrichment job explicitly JOINs when needed
- Clear separation: `scotus_cases` = metadata, `scotus_opinions` = text blob

---

#### 2. fetch-cases.js Changes

**File:** `scripts/scotus/fetch-cases.js`

**2a. Add hash + upsert helpers (new functions, add near top of file)**

```javascript
import crypto from 'crypto';

/**
 * Compute sha256 hex hash of text
 * Used to detect content changes and skip no-op writes
 */
function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Upsert opinion only if content changed (hash mismatch)
 * Prevents wasted DB writes during backfill/retries
 *
 * @returns {{ changed: boolean, content_hash: string, error?: string }}
 */
async function upsertOpinionIfChanged(supabase, caseId, canonicalText) {
  const content_hash = sha256Hex(canonicalText);

  // Check existing hash
  const { data: existing, error: readErr } = await supabase
    .from('scotus_opinions')
    .select('content_hash')
    .eq('case_id', caseId)
    .maybeSingle();

  if (readErr) {
    return { changed: false, content_hash, error: readErr.message };
  }

  // Skip if unchanged
  if (existing?.content_hash === content_hash) {
    return { changed: false, content_hash };
  }

  // Upsert with new content
  const { error: upsertErr } = await supabase
    .from('scotus_opinions')
    .upsert({
      case_id: caseId,
      opinion_full_text: canonicalText,
      content_hash,
      updated_at: new Date().toISOString()
    }, { onConflict: 'case_id' });

  if (upsertErr) {
    return { changed: false, content_hash, error: upsertErr.message };
  }

  return { changed: true, content_hash };
}
```

**2b. Add canonical text builder (new function, ~line 245)**

```javascript
/**
 * Build canonical opinion text from all opinion documents
 * Order: MAJORITY/LEAD → CONCURRENCES → DISSENTS → UNKNOWN
 * Adds section headers for GPT parsing
 *
 * ROBUST HANDLING:
 * - Includes ALL majority/lead docs (not just first)
 * - Logs unknown opinion types for future tuning
 * - Handles missing type values gracefully
 *
 * @param {Array} opinions - Array of opinion objects from CourtListener
 * @returns {string} Concatenated text with section headers
 */
function buildCanonicalOpinionText(opinions) {
  if (!opinions || opinions.length === 0) return null;

  const sections = [];
  const unknownTypes = [];
  const processed = new Set();  // Track processed opinion IDs to avoid dupes

  // Category patterns (order matters for classification)
  const MAJORITY_PATTERN = /majority|lead|per.?curiam|combined|opinion.of.the.court/i;
  const CONCUR_PATTERN = /concur/i;
  const DISSENT_PATTERN = /dissent/i;
  const STATEMENT_PATTERN = /statement/i;  // "statement of X" - treat as concurrence-like

  // 1. ALL Majority/Lead/Per Curiam opinions (not just first)
  const majorities = opinions.filter(o =>
    MAJORITY_PATTERN.test(o.type || '') && !DISSENT_PATTERN.test(o.type || '')
  );
  for (const op of majorities) {
    if (op.plain_text) {
      const author = op.author_str || '';
      const label = author ? `MAJORITY OPINION (${author})` : 'MAJORITY OPINION';
      sections.push(`=== ${label} ===\n${op.plain_text}`);
      processed.add(op.id);
    }
  }

  // 2. Concurrences (including "statement of")
  const concurrences = opinions.filter(o => {
    const type = o.type || '';
    return (CONCUR_PATTERN.test(type) || STATEMENT_PATTERN.test(type))
      && !DISSENT_PATTERN.test(type)
      && !processed.has(o.id);
  });
  for (const op of concurrences) {
    if (op.plain_text) {
      const author = op.author_str || 'Unknown';
      sections.push(`=== CONCURRENCE (${author}) ===\n${op.plain_text}`);
      processed.add(op.id);
    }
  }

  // 3. Dissents last (critical for Pass 1 dissent extraction)
  const dissents = opinions.filter(o =>
    DISSENT_PATTERN.test(o.type || '') && !processed.has(o.id)
  );
  for (const op of dissents) {
    if (op.plain_text) {
      const author = op.author_str || 'Unknown';
      sections.push(`=== DISSENT (${author}) ===\n${op.plain_text}`);
      processed.add(op.id);
    }
  }

  // 4. Handle unclassified opinions (log for future tuning)
  const unprocessed = opinions.filter(o => !processed.has(o.id) && o.plain_text);
  for (const op of unprocessed) {
    const type = op.type || 'null';
    unknownTypes.push(type);
    const author = op.author_str || 'Unknown';
    sections.push(`=== OTHER (${author}, type: ${type}) ===\n${op.plain_text}`);
  }

  // Log unknown types for debugging/tuning
  if (unknownTypes.length > 0) {
    console.log(`   [CANONICAL] Unknown opinion types encountered: ${unknownTypes.join(', ')}`);
  }

  // Fallback: if somehow nothing matched, use all opinions in order
  if (sections.length === 0) {
    for (const op of opinions) {
      if (op.plain_text) {
        sections.push(op.plain_text);
      }
    }
  }

  return sections.join('\n\n') || null;
}
```

**2b. Update processCluster() (~line 400-440)**

```javascript
// BEFORE (line ~409):
const plainText = primaryOpinion?.plain_text || null;

// AFTER:
const canonicalText = buildCanonicalOpinionText(opinions);

// ... existing caseRecord build ...

// AFTER caseRecord upsert succeeds, insert into scotus_opinions:
if (canonicalText && !dryRun) {
  const result = await upsertOpinionIfChanged(supabase, caseId, canonicalText);

  if (result.error) {
    // CRITICAL: Do NOT update source_data_version if opinion write failed
    // Leave as v1 so backfill can retry later
    console.warn(`   [WARN] Failed to store opinion text: ${result.error}`);
    console.warn(`   [WARN] Leaving source_data_version as v1 for retry`);
  } else if (!result.changed) {
    // Content unchanged - skip version update too (already v2)
    console.log(`   [SKIP] Opinion unchanged (hash match)`);
  } else {
    // ONLY update version AFTER successful opinion write
    console.log(`   [OK] Opinion stored (${canonicalText.length} chars, hash: ${result.content_hash.slice(0, 8)}...)`);
    await supabase
      .from('scotus_cases')
      .update({ source_data_version: 'v2-full-opinion' })
      .eq('id', caseId);
  }
}
```

**2c. Get case ID from upsert (modify upsert call, ~line 456-470)**

```javascript
// BEFORE:
const { error } = await supabase
  .from('scotus_cases')
  .upsert(caseRecord, { onConflict: 'docket_number' });

// AFTER:
// PREREQ: docket_number must have UNIQUE constraint in DB
// (Already exists: migration 068_scotus_docket_unique.sql from ADO-281)
// If duplicates exist, .single() will error - that's intentional (data bug)
const { data: upsertedCase, error } = await supabase
  .from('scotus_cases')
  .upsert(caseRecord, { onConflict: 'docket_number' })
  .select('id')
  .single();

if (error) {
  console.error(`   [ERROR] Failed to upsert case: ${error.message}`);
  return false;
}

const caseId = upsertedCase?.id;
if (!caseId) {
  console.error(`   [ERROR] Upsert succeeded but no case ID returned`);
  return false;
}
```

---

#### 3. Enrichment Query Changes

**File:** `scripts/enrichment/scotus-fact-extraction.js`

**3a. Update getCasesToEnrich() (~line 691)**

```javascript
// BEFORE:
.select('id, case_name, syllabus, opinion_excerpt, term, ...')

// AFTER: LEFT JOIN to scotus_opinions for full text
// CRITICAL: Use !left to ensure cases WITHOUT opinion rows are still returned
// (otherwise cases during backfill rollout will be silently excluded)
async function getCasesToEnrich(limit, supabase) {
  const { data, error } = await supabase
    .from('scotus_cases')
    .select(`
      id, case_name, syllabus, opinion_excerpt, term, decided_at,
      vote_split, majority_author, dissent_authors, issue_area, docket_number,
      source_data_version,
      scotus_opinions!left(opinion_full_text)
    `)
    .in('enrichment_status', ['pending', 'failed'])
    // REMOVED: .or('syllabus.not.is.null,opinion_excerpt.not.is.null')
    // Reason: Would exclude v2 cases where only opinion_full_text exists
    // Pass 0 gate handles "no source text" cases - don't filter here
    .order('decided_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  // Flatten joined opinion text (Supabase can return object OR array depending on FK inference)
  return data.map(row => {
    const joined = row.scotus_opinions;
    const opinion_full_text = Array.isArray(joined)
      ? joined[0]?.opinion_full_text
      : joined?.opinion_full_text;

    return {
      ...row,
      opinion_full_text: opinion_full_text || null,
      scotus_opinions: undefined  // Remove nested object
    };
  });
}
```

**3b. Update getSourceText with windowing (~line 145)**

```javascript
/**
 * TOKEN WINDOWING STRATEGY
 * For very long opinions (>100K chars / ~25K tokens):
 * - First 40K chars: captures syllabus + majority holding
 * - Last 30K chars: captures dissents (always at end)
 * - Middle gap is acceptable - key facts are at ends
 */
const MAX_CHARS_FOR_GPT = 100000;  // ~25K tokens
const FIRST_WINDOW = 40000;
const LAST_WINDOW = 30000;

function getSourceText(scotusCase) {
  // Prefer full opinion if available (v2)
  let text = scotusCase.opinion_full_text
    || scotusCase.syllabus
    || scotusCase.opinion_excerpt
    || '';

  // Apply windowing for very long opinions
  const originalLength = text.length;
  if (originalLength > MAX_CHARS_FOR_GPT) {
    const first = text.slice(0, FIRST_WINDOW);
    const last = text.slice(-LAST_WINDOW);
    const omitted = originalLength - FIRST_WINDOW - LAST_WINDOW;
    text = `${first}\n\n[... ${omitted} chars omitted ...]\n\n${last}`;
    console.log(`   [WINDOW] Applied windowing: ${scotusCase.case_name} (${originalLength} → ${text.length} chars)`);
  }

  return text;
}
```

---

#### 4. Pass 0 Gate Changes (Structural Validation)

**File:** `scripts/enrichment/scotus-fact-extraction.js`

```javascript
// BEFORE: Length-only validation
const HARD_MIN = 200;
const SOFT_MIN = 600;

// AFTER: Length + structural markers
const HARD_MIN = 1000;   // Full opinion should be at least 1K
const SOFT_MIN = 5000;   // Expect at least 5K for real opinions

/**
 * SCOTUS structural markers - at least ONE must be present
 * Catches padded junk, malformed captures, duplicate headers
 *
 * INCLUDES our own section headers (=== MAJORITY/DISSENT ===)
 * to handle edge cases where CourtListener text is stripped but
 * canonical builder still produced valid output
 */
const SCOTUS_STRUCTURAL_MARKERS = [
  /SUPREME COURT OF THE UNITED STATES/i,
  /\bSyllabus\b/i,
  /\bJUSTICE\s+\w+\s+delivered/i,
  /\bPER CURIAM\b/i,
  /\b(affirmed|reversed|vacated|remanded)\b/i,
  /\bCertiorari\b/i,
  // Our canonical section headers (v2)
  /===\s*MAJORITY OPINION\s*===/,
  /===\s*DISSENT\b/,
];

function checkSourceQuality(scotusCase) {
  const sourceText = scotusCase.opinion_full_text
    || scotusCase.syllabus
    || scotusCase.opinion_excerpt
    || '';
  const charCount = sourceText.length;

  // Length checks
  if (charCount < HARD_MIN) {
    return { passed: false, reason: `Too short: ${charCount} chars < ${HARD_MIN}` };
  }

  // Structural validation: must have at least one SCOTUS marker
  const hasStructuralMarker = SCOTUS_STRUCTURAL_MARKERS.some(p => p.test(sourceText));
  if (!hasStructuralMarker) {
    return {
      passed: false,
      reason: 'No SCOTUS structural markers found (may be junk/malformed)',
      charCount
    };
  }

  // Soft minimum with anchor rescue
  // NOTE: ANCHOR_PATTERNS already exists in this file (~line 133)
  // Contains: /\b(affirmed|reversed|held|ruling)\b/i, /\bpetitioner\b/i, etc.
  const hasAnchors = ANCHOR_PATTERNS.some(p => p.test(sourceText));
  if (charCount < SOFT_MIN && !hasAnchors) {
    return {
      passed: false,
      reason: `Below soft min (${charCount} < ${SOFT_MIN}) and no anchors`,
      charCount
    };
  }

  return { passed: true, charCount, hasStructuralMarker: true };
}
```

---

#### 5. Pass 1 Prompt Changes

**File:** `scripts/enrichment/scotus-gpt-prompt.js`

```javascript
// AFTER: Prompt acknowledges full opinion with section headers
const FACT_EXTRACTION_PROMPT = `
You are a SCOTUS fact extractor. You will receive the FULL opinion text with section headers.

DOCUMENT STRUCTURE (sections marked with ===):
1. === MAJORITY OPINION === - Contains syllabus + full legal reasoning
2. === CONCURRENCE (Justice Name) === - Agreeing justices' separate views (if any)
3. === DISSENT (Justice Name) === - Disagreeing justices' arguments (if any)

EXTRACTION PRIORITY:
1. Find DISPOSITION early in majority (syllabus section): affirmed/reversed/vacated/remanded
2. Extract HOLDING from syllabus (first ~5K chars of majority)
3. For DISSENT_EXISTS: check if === DISSENT sections exist
4. For DISSENT highlights: look at === DISSENT sections specifically
5. For vote split: look for "X-X" pattern near case header

IMPORTANT:
- Dissents are EXPLICITLY marked with === DISSENT headers - use them
- If no dissent section exists, dissent_exists = false
- Concurrences are NOT dissents

OUTPUT SCHEMA:
{ ... same as before ... }
`;
```

---

#### 6. Cost Recalculation (Corrected)

| Component | Tokens | Cost (GPT-4o-mini) | Notes |
|-----------|--------|-------------------|-------|
| Pass 1 Run #1 | ~10,000 input + ~500 output | $0.0016 | Full opinion input |
| Pass 1 Run #2 | ~10,000 input + ~500 output | $0.0016 | Consensus check |
| Pass 2 | ~500 input + ~500 output | $0.00015 | Compressed facts only |
| **Total per case** | ~21,500 tokens | **$0.0033** | |
| **50 cases/term** | ~1M tokens | **$0.17** | vs $0.01 with syllabus |

**Additional cost vs syllabus approach: ~$0.16/term** - Still trivial.

**Windowing savings:** Cases >100K chars get windowed to ~70K chars (~17.5K tokens) instead of full. Saves ~30% on outliers.

---

#### 7. Backfill Strategy (In-Place, Not Delete+Refetch)

```bash
# Step 1: Identify cases needing backfill
SELECT id, case_name, source_data_version
FROM scotus_cases
WHERE source_data_version = 'v1-syllabus'
   OR source_data_version IS NULL;

# Step 2: Run backfill script (new script)
node scripts/scotus/backfill-opinions.js --limit=50

# Step 3: Verify backfill
SELECT
  sc.source_data_version,
  COUNT(*) as count,
  AVG(so.char_count) as avg_chars
FROM scotus_cases sc
LEFT JOIN scotus_opinions so ON so.case_id = sc.id
GROUP BY sc.source_data_version;
```

**backfill-opinions.js implementation:**

**File:** `scripts/scotus/backfill-opinions.js` (NEW)

```javascript
#!/usr/bin/env node
/**
 * Backfill scotus_opinions for existing cases
 *
 * Usage: COURTLISTENER_API_TOKEN=xxx node scripts/scotus/backfill-opinions.js --limit=50
 *
 * This script:
 * 1. Queries scotus_cases WHERE source_data_version != 'v2-full-opinion'
 * 2. For each case, fetches opinions from CourtListener using courtlistener_cluster_id
 * 3. Builds canonical text with buildCanonicalOpinionText()
 * 4. Upserts into scotus_opinions
 * 5. Updates scotus_cases.source_data_version = 'v2-full-opinion'
 *
 * IMPORTANT: Does NOT modify enrichment fields - preserves existing enrichment state
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const COURTLISTENER_TOKEN = process.env.COURTLISTENER_API_TOKEN;

// --- Hash helper ---
function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// --- Import from opinion-utils.js or copy from Section 2a ---
// buildCanonicalOpinionText()
// upsertOpinionIfChanged()
const COURTLISTENER_BASE = 'https://www.courtlistener.com/api/rest/v4';

// Parse CLI args
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace('--', '').split('=');
  acc[key] = val ?? true;
  return acc;
}, {});

const limit = args.limit ? parseInt(args.limit) : 10;
const dryRun = args['dry-run'] === true;
const useProd = args.prod === true;

// Environment detection (same pattern as other scripts)
const supabaseUrl = useProd
  ? process.env.SUPABASE_URL
  : process.env.SUPABASE_TEST_URL;
const supabaseKey = useProd
  ? process.env.SUPABASE_SERVICE_KEY
  : process.env.SUPABASE_TEST_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(`Missing Supabase credentials for ${useProd ? 'PROD' : 'TEST'}`);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log(`Environment: ${useProd ? 'PROD' : 'TEST'}`);

// --- RECOMMENDED: Create shared module to avoid duplication ---
// File: scripts/scotus/opinion-utils.js
// Export buildCanonicalOpinionText() and import in both fetch-cases.js and backfill-opinions.js

// For now, copy the FULL implementation from Section 2a above (the robust version)
// See Section 2a for the complete buildCanonicalOpinionText() with:
// - Multiple majority doc handling
// - Unknown type logging
// - Proper concurrence/dissent/statement classification
import { buildCanonicalOpinionText } from './opinion-utils.js';
// OR copy the ~80 line implementation from Section 2a

async function fetchOpinions(clusterId) {
  const allResults = [];
  let url = `${COURTLISTENER_BASE}/opinions/?cluster=${clusterId}`;

  // Handle pagination (CourtListener can paginate large result sets)
  while (url) {
    const response = await fetch(url, {
      headers: { 'Authorization': `Token ${COURTLISTENER_TOKEN}` }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    allResults.push(...(data.results || []));
    url = data.next || null;  // Follow pagination
  }

  return allResults;
}

async function backfillCase(scotusCase) {
  console.log(`Processing: ${scotusCase.case_name}`);

  // Fetch opinions from CourtListener
  const opinions = await fetchOpinions(scotusCase.courtlistener_cluster_id);
  if (!opinions.length) {
    console.log(`   [SKIP] No opinions found`);
    return false;
  }

  const canonicalText = buildCanonicalOpinionText(opinions);
  if (!canonicalText) {
    console.log(`   [SKIP] No text extracted`);
    return false;
  }

  console.log(`   [OK] Built canonical text: ${canonicalText.length} chars`);

  if (dryRun) {
    const hash = sha256Hex(canonicalText);
    console.log(`   [DRY RUN] Would upsert (hash: ${hash.slice(0, 8)}...)`);
    return true;
  }

  // Upsert only if changed (uses content_hash)
  const result = await upsertOpinionIfChanged(supabase, scotusCase.id, canonicalText);

  if (result.error) {
    console.error(`   [ERROR] scotus_opinions upsert: ${result.error}`);
    return false;
  }

  if (!result.changed) {
    console.log(`   [SKIP] Content unchanged (hash match)`);
    // Still ensure version is set (idempotent)
    await supabase
      .from('scotus_cases')
      .update({ source_data_version: 'v2-full-opinion' })
      .eq('id', scotusCase.id);
    return true;
  }

  // Update main table version (DO NOT touch enrichment fields)
  const { error: caseErr } = await supabase
    .from('scotus_cases')
    .update({ source_data_version: 'v2-full-opinion' })
    .eq('id', scotusCase.id);

  if (caseErr) {
    console.error(`   [ERROR] scotus_cases update: ${caseErr.message}`);
    return false;
  }

  console.log(`   [OK] Backfilled (hash: ${result.content_hash.slice(0, 8)}...)`);
  return true;
}

async function main() {
  console.log(`\n=== Backfill SCOTUS Opinions ===\n`);
  console.log(`Limit: ${limit}, Dry run: ${dryRun}\n`);

  // Query cases needing backfill
  const { data: cases, error } = await supabase
    .from('scotus_cases')
    .select('id, case_name, courtlistener_cluster_id, source_data_version')
    .or('source_data_version.neq.v2-full-opinion,source_data_version.is.null')
    .not('courtlistener_cluster_id', 'is', null)
    .limit(limit);

  if (error) {
    console.error('Query error:', error.message);
    process.exit(1);
  }

  console.log(`Found ${cases.length} cases to backfill\n`);

  let success = 0, failed = 0;
  for (const c of cases) {
    try {
      const ok = await backfillCase(c);
      if (ok) success++; else failed++;
    } catch (err) {
      console.error(`   [ERROR] ${err.message}`);
      failed++;
    }
    // Rate limiting
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n=== Done: ${success} success, ${failed} failed ===\n`);
}

main().catch(console.error);
```

---

#### 8. DB_COLUMNS Whitelist Update

**File:** `scripts/enrichment/scotus-fact-extraction.js` (~line 79)

```javascript
// Add to DB_COLUMNS whitelist:
export const DB_COLUMNS = new Set([
  // ... existing columns ...
  'source_data_version',  // NEW: tracks v1/v2 approach
  // NOTE: opinion_full_text is in scotus_opinions table, not here
]);
```

---

#### 9. Verification Queries

```sql
-- After migration 068:
SELECT table_name FROM information_schema.tables
WHERE table_name = 'scotus_opinions';

-- After fetch with canonical text:
SELECT
  sc.id, sc.case_name, sc.source_data_version,
  so.char_count,
  LEFT(so.opinion_full_text, 100) as preview
FROM scotus_cases sc
JOIN scotus_opinions so ON so.case_id = sc.id
ORDER BY sc.decided_at DESC LIMIT 5;

-- Verify section headers present:
SELECT case_id,
  (opinion_full_text LIKE '%=== MAJORITY OPINION ===%') as has_majority,
  (opinion_full_text LIKE '%=== DISSENT%') as has_dissent
FROM scotus_opinions LIMIT 10;

-- After enrichment run:
SELECT
  source_data_version,
  enrichment_status,
  COUNT(*) as count
FROM scotus_cases
GROUP BY source_data_version, enrichment_status;
```

---

#### 10. Deferred Items (from ADO-281, P3 priority)

> These are nice-to-have polish items moved from ADO-281 (now closed).
> Not blocking v2 release but should be addressed eventually.

| Item | File | Issue | Fix |
|------|------|-------|-----|
| Number validation over-strict | `scotus-drift-validation.js:190-193` | Flags `$100,000` vs `$100K` as drift | Normalize numbers before comparison |
| Pass 2 disposition lock | `scotus-gpt-prompt.js` | Lock only in user prompt, not system | Add to `PASS2_SYSTEM_PROMPT` |

> **Resolved (no longer deferred):**
> - ~~Content hash~~ → Added `content_hash` column to `scotus_opinions` (Section 1)
> - ~~Version duplication~~ → Removed redundant version from `scotus_opinions` (Section 1)

---

### Testing Plan

#### Phase 0: Apply Migration
```bash
# Apply migration 068
node scripts/apply-migrations.js

# Verify tables created
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('scotus_cases', 'scotus_opinions');

# Verify constraint
SELECT constraint_name FROM information_schema.check_constraints
WHERE constraint_name = 'chk_source_data_version';
```

#### Phase 1: Test Fetch with Canonical Text (Small Batch)
```bash
# Fetch 5 cases with new canonical text builder
COURTLISTENER_API_TOKEN=xxx node scripts/scotus/fetch-cases.js --since=2024-10-01 --limit=5

# Verify scotus_opinions populated
SELECT
  sc.id, sc.case_name, sc.source_data_version,
  so.char_count,
  (so.opinion_full_text LIKE '%=== MAJORITY OPINION ===%') as has_majority_header,
  (so.opinion_full_text LIKE '%=== DISSENT%') as has_dissent_header
FROM scotus_cases sc
LEFT JOIN scotus_opinions so ON so.case_id = sc.id
ORDER BY sc.decided_at DESC LIMIT 5;

# Verify section headers in one case
SELECT LEFT(opinion_full_text, 500) as preview
FROM scotus_opinions LIMIT 1;
```

#### Phase 2: Test Enrichment with Full Opinions
```bash
# Dry run enrichment on 3 test cases
node scripts/scotus/enrich-scotus.js --limit=3 --dry-run

# Check output quality manually:
# - Are vote splits correct?
# - Are dissent highlights extracted from === DISSENT sections?
# - Did windowing trigger for any case? (check logs for [WINDOW])
# - Did structural validation pass? (check for SCOTUS markers)
```

#### Phase 3: Test Windowing on Large Case
```bash
# Find a case with >100K chars
SELECT sc.case_name, sc.id, so.char_count
FROM scotus_cases sc
JOIN scotus_opinions so ON so.case_id = sc.id
WHERE so.char_count > 100000
LIMIT 1;

# Reset that case to pending so it gets picked up
UPDATE scotus_cases SET enrichment_status = 'pending' WHERE id = '<id>';

# Run enrichment with limit=1 to test just that case
node scripts/scotus/enrich-scotus.js --limit=1 --dry-run
# Should see "[WINDOW] Applied windowing" in logs
```

> **Note:** If you want a `--case-id` flag for targeted testing, add to enrich-scotus.js:
> ```javascript
> const caseIdFilter = args['case-id'];
> // In query: .eq('id', caseIdFilter) if caseIdFilter is set
> ```

#### Phase 4: Backfill Existing Cases
```bash
# Run backfill for cases without full opinions
node scripts/scotus/backfill-opinions.js --limit=50

# Verify all cases now have v2
SELECT source_data_version, COUNT(*) FROM scotus_cases GROUP BY 1;
```

#### Phase 5: Full Enrichment Run
```bash
# If Phase 2-4 pass, run full enrichment
node scripts/scotus/enrich-scotus.js --limit=50

# Verify results
SELECT enrichment_status, confidence, COUNT(*)
FROM scotus_cases
WHERE source_data_version = 'v2-full-opinion'
GROUP BY 1, 2;
```

### Cost Comparison (Corrected)

| Approach | Pass 1 (×2) | Pass 2 | Total/Case | 50 Cases/Term |
|----------|-------------|--------|------------|---------------|
| Syllabus (v1) | 2 × 1.5K tokens | 1K tokens | ~$0.0006 | $0.03 |
| **Full opinion (v2)** | 2 × 10K tokens | 1K tokens | **$0.0033** | **$0.17** |
| **With windowing (>100K)** | 2 × 17.5K tokens | 1K tokens | $0.0055 | $0.28 (if all outliers) |

**Realistic term cost: ~$0.17** (most cases <100K chars)

**Budget guardrail:** Token windowing caps outliers at ~70K chars (~17.5K tokens)

### Benefits Summary

| Benefit | Impact |
|---------|--------|
| No more regex extraction failures | Pass 0 should rarely fail |
| Full dissent text with headers | GPT sees `=== DISSENT ===` markers explicitly |
| Multi-opinion coverage | Concurrences and all dissents included |
| Separate table isolation | UI can't accidentally pull 140K per row |
| Structural validation | Catches junk/malformed before GPT call |
| Token windowing | Cost-predictable even for outliers |
| In-place backfill | Preserves existing enrichment state |

### ADO Ticket: ADO-283

**Created:** [ADO-283](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/283)

**Scope (updated with architecture review):**
1. ✅ Schema migration 068 (separate `scotus_opinions` table + CHECK constraint)
2. Update `fetch-cases.js`:
   - Add `buildCanonicalOpinionText()` function
   - Upsert to `scotus_opinions` table
   - Update `source_data_version` on main table
3. Update `scotus-fact-extraction.js`:
   - JOIN query for `getCasesToEnrich()`
   - Add `getSourceText()` with windowing
   - Add structural markers to `checkSourceQuality()`
   - Update `DB_COLUMNS` whitelist
4. Update `scotus-gpt-prompt.js`:
   - Update prompts for section headers
5. Create `backfill-opinions.js` script
6. Test enrichment quality

**Depends on:** ADO-280 (two-pass architecture) ✅ DONE

---

## 📦 ARCHIVED: Original v1 Syllabus Approach

> **⚠️ SUPERSEDED BY ADO-283 (Full Opinion Architecture)**
>
> The sections below document the original v1 approach that used extracted syllabus text.
> This approach was abandoned because:
> 1. CourtListener's `syllabus` field is always empty for SCOTUS clusters
> 2. Regex extraction from `plain_text` is fragile and misses edge cases
> 3. Extracted text often truncated, causing GPT hallucination
>
> **For current implementation, see "Full Opinion Architecture" section above.**

---

## Overview (v1 - Archived)

Create `enrich-scotus.js` script that calls GPT to generate editorial analysis for SCOTUS cases fetched by `fetch-cases.js`.

---

## What We're Analyzing (v1 - Archived)

### Input: The Syllabus

SCOTUS opinions have a standardized structure. The **syllabus** is a ~500-3000 character summary prepared by the Court Reporter that includes:

- The legal question presented
- How the case reached SCOTUS
- The holding (what they decided)
- Key reasoning from the majority

**Example from database (Kaiser Gypsum case):**
```
Petitioner Truck Insurance Exchange is the primary insurer for companies
that manufactured and sold products containing asbestos... Truck sought
to oppose the Plan under §1109(b) of the Bankruptcy Code... The District
Court confirmed the Plan. It concluded, among other things, that Truck
had limited standing...
```

### Why Syllabus (Not Full Opinion)

| Option | Size | Cost | Quality |
|--------|------|------|---------|
| Full opinion | 20K-100K chars | $0.10-0.50/case | Overkill, mostly procedural |
| **Syllabus** | 500-3000 chars | ~$0.01/case | Perfect - has the key holding |
| Opinion excerpt | 500 chars | ~$0.005/case | Too little context |

The syllabus is the sweet spot: enough context for GPT to understand the ruling, small enough to be cheap.

### Additional Context Sent to GPT

Beyond syllabus, we also send:
- `case_name` - Who vs Who
- `term` - Which SCOTUS term (e.g., "2024")
- `decided_at` - When decided
- `vote_split` - "6-3", "9-0", etc. (if available)
- `majority_author` - Who wrote it
- `dissent_authors[]` - Who dissented
- `issue_area` - voting_rights, agency_power, etc. (if classified)

---

## Clarification: The "500 char quote" Reference

The original ADO-85 description mentioned "Max quote length: 500 chars" - this was for a **claims[] validation system** that was never implemented:

```javascript
// Original vision (NOT IMPLEMENTED):
claims: [
  {
    claim: "Court gutted Chevron deference",
    quote_span: "agencies no longer entitled to...",  // max 500 chars
    confidence: 8
  }
]
```

**We are NOT implementing this.** Instead, we use simpler `evidence_anchors[]`:

```javascript
// What we actually use:
evidence_anchors: ["syllabus", "majority §II.A", "dissent, Sotomayor J."]
```

This tells the reader WHERE the analysis comes from without requiring machine-checkable quote validation.

---

## Output Fields

GPT generates these fields for each case:

| Field | Description | Validation |
|-------|-------------|------------|
| `ruling_impact_level` | 0-5 scale | Required, 0-5 |
| `ruling_label` | "Constitutional Crisis", etc. | Must match predefined labels |
| `who_wins` | Specific beneficiary | Min 5 chars |
| `who_loses` | Specific victim | Min 5 chars |
| `summary_spicy` | 3-4 sentence editorial | 100-1500 chars |
| `why_it_matters` | Systemic implications | 50-600 chars |
| `dissent_highlights` | Key dissent warning | 30-500 chars or null |
| `evidence_anchors` | Citation references | Non-empty array |

---

## Implementation Steps

### 1. Query Cases for Enrichment

> ⚠️ **DEPRECATED:** The query below uses `enriched_at IS NULL` which is wrong.
> **Use 6.9 Run Selection Query** instead - it correctly filters by `enrichment_status`.

```javascript
// ❌ OLD - DO NOT USE
const { data: cases } = await supabase
  .from('scotus_cases')
  .select('*')
  .is('enriched_at', null)  // WRONG: misses flagged cases, re-selects failed
  .not('syllabus', 'is', null)
  .order('decided_at', { ascending: false })
  .limit(batchSize);

// ✅ CORRECT - Use getCasesToEnrich() from Phase 6.9
const cases = await getCasesToEnrich(batchSize, supabase);
```

### 2. Build Prompt with Variation

```javascript
import { SYSTEM_PROMPT, buildUserPrompt, validateEnrichmentResponse } from './scotus-gpt-prompt.js';
import { getPoolType, selectVariation, buildVariationInjection } from './scotus-variation-pools.js';

// Select variation based on estimated impact level
const poolType = getPoolType(estimatedLevel, scotusCase.issue_area);
const variation = selectVariation(poolType, recentlyUsedIds);
const variationInjection = buildVariationInjection(variation, recentOpenings);

// Build user prompt
const userPrompt = buildUserPrompt(scotusCase, variationInjection);
```

### 3. Call GPT-4o-mini

```javascript
const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt }
  ],
  response_format: { type: 'json_object' },
  temperature: 0.7,
  max_tokens: 1500
});
```

### 4. Validate Response

```javascript
const enrichment = JSON.parse(response.choices[0].message.content);
const { valid, errors } = validateEnrichmentResponse(enrichment);

if (!valid) {
  console.error(`Validation failed for case ${scotusCase.id}:`, errors);
  // Log error, maybe retry once
  continue;
}
```

### 5. Write to Database

> ⚠️ **DEPRECATED (v1):** This was the original single-pass approach.
> **See Phase 6** for the new `writeEnrichment()` and `flagAndSkip()` functions
> which implement confidence-based publishing rules.

```javascript
// OLD v1 approach - DO NOT USE
// - Always set is_public: true (wrong - should be confidence-based)
// - No enrichment_status tracking (causes retry loops)
// - No flagging for low-confidence cases
const { error } = await supabase
  .from('scotus_cases')
  .update({
    ruling_impact_level: enrichment.ruling_impact_level,
    ruling_label: enrichment.ruling_label,
    who_wins: enrichment.who_wins,
    who_loses: enrichment.who_loses,
    summary_spicy: enrichment.summary_spicy,
    why_it_matters: enrichment.why_it_matters,
    dissent_highlights: enrichment.dissent_highlights,
    evidence_anchors: enrichment.evidence_anchors,
    enriched_at: new Date().toISOString(),
    prompt_version: 'v1-ado85',
    is_public: true  // ❌ WRONG - should be confidence-based
  })
  .eq('id', scotusCase.id);
```

### 6. Track Cost

```javascript
// Estimate: ~1500 input tokens (syllabus + metadata + prompt)
//           ~500 output tokens
// GPT-4o-mini: $0.15/1M input, $0.60/1M output
// Cost per case: ~$0.0005 input + ~$0.0003 output = ~$0.0008
// Round up to ~$0.01 for safety margin

await trackCost('scotus_enrichment', 0.01);
```

---

## File Structure

```
scripts/scotus/
├── fetch-cases.js          # ✅ Exists - fetches from CourtListener
├── enrich-scotus.js        # 🔲 To create - GPT enrichment
└── README.md               # ✅ Exists - usage docs

scripts/enrichment/
├── scotus-gpt-prompt.js    # ✅ Exists - system prompt, validation
└── scotus-variation-pools.js # ✅ Exists - opening patterns
```

---

## Usage

```bash
# Enrich all unenriched cases (with syllabus)
node scripts/scotus/enrich-scotus.js

# Enrich specific number
node scripts/scotus/enrich-scotus.js --limit=10

# Dry run (no DB writes)
node scripts/scotus/enrich-scotus.js --limit=5 --dry-run
```

---

## Cost Estimate

| Cases | Input Tokens | Output Tokens | Estimated Cost |
|-------|--------------|---------------|----------------|
| 1 | ~1,500 | ~500 | ~$0.01 |
| 10 | ~15,000 | ~5,000 | ~$0.10 |
| 50 | ~75,000 | ~25,000 | ~$0.50 |

Well within $50/month budget.

---

## Acceptance Criteria

- [x] Script queries unenriched cases with syllabus OR excerpt
- [x] Calls GPT with existing prompt infrastructure
- [x] Validates responses before writing
- [x] Sets `enriched_at` and `is_public` based on confidence (high=public, medium/low=not public)
- [x] Tracks cost in budgets table
- [x] Handles errors gracefully (logs, continues)
- [x] CLI flags: `--limit`, `--dry-run`, `--prod`
- [ ] **Factual accuracy** - GPT output matches actual case holdings ⚠️ BLOCKED

---

## Test Plan

1. **Dry run with 3 cases** - ✅ Verified prompt construction
2. **Enrich 3 cases** - ✅ DB writes working
3. **Check validation** - ✅ Validation catches malformed responses
4. **Check RLS** - ✅ Confidence-gated publishing (high=public, medium/low=not public)
5. **Review output quality** - ❌ FAILED - GPT hallucinated facts on all 3 cases

### Test Results (2026-01-21)

| Case ID | Case Name | Validation | DB Write | Factual Accuracy |
|---------|-----------|------------|----------|------------------|
| 11 | FDA v. Alliance | ✅ | ✅ | ❌ Wrong (standing case, not pharma win) |
| 12 | Starbucks v. McKinney | ✅ | ✅ | ❌ Wrong (bad for workers, not good) |
| 4 | Connelly v. United States | ✅ | ✅ | ❌ Wrong (tax case, not corps vs small biz) |

**Conclusion:** Script works mechanically, but output is factually unreliable. Need two-pass architecture.

---

## 🔧 Two-Pass Architecture Implementation ([ADO-280](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/280))

**Status:** READY TO IMPLEMENT (code review fixes incorporated)

### Problem
Single-pass enrichment asks GPT to simultaneously:
1. Extract facts from legal text
2. Determine who won/lost
3. Apply editorial tone

When source material is insufficient or complex, GPT conflates these tasks and hallucinates facts to fit the requested tone.

### Solution: Three-Stage Pipeline

```
Pass 0: Source Quality Gate (pre-GPT check)
   ↓ (skip to flagAndSkip if low)
Pass 1: Fact Extraction (neutral, no tone)
   ↓ (skip to flagAndSkip if low confidence)
Pass 2: Editorial Framing (facts locked in)
   ↓ (drift validation safety net)
Write to DB
```

---

## Phase 1: Pass 0 - Source Quality Gate

**File:** `scripts/enrichment/scotus-fact-extraction.js`

Runtime check BEFORE calling GPT. Returns Pass 1-shaped object for consistent handling.

```javascript
function checkSourceQuality(scotusCase) {
  const sourceText = scotusCase.syllabus || scotusCase.opinion_excerpt || '';
  const charCount = sourceText.length;

  // TIGHTER anchor detection - require dispositive PHRASES not single words
  const anchorPatterns = [
    /\bjudgment\s+(is\s+)?(affirmed|reversed|vacated|remanded)\b/i,
    /\b(dismiss(ed|es)?)\b.{0,30}\b(standing|jurisdiction|moot)\b/i,
    /\bheld\s+that\b/i,
    /\bwe\s+hold\b/i,
    /\bthe\s+(petition|application)\s+(is\s+)?(granted|denied)\b/i,
  ];
  const hasAnchors = anchorPatterns.some(p => p.test(sourceText));

  // Thresholds
  const HARD_MIN = 200;        // Below this, always fail (likely just a header)
  const SOFT_MIN = 600;        // Below this, need anchors to pass
  const tooShort = charCount < SOFT_MIN;

  // Logic: anchors can rescue short text, but not impossibly short
  const isLow = (charCount < HARD_MIN) || (tooShort && !hasAnchors);

  if (isLow) {
    // Determine the specific failure reason
    let reason;
    if (charCount < HARD_MIN) {
      reason = `Source text critically short (${charCount} chars < ${HARD_MIN}) - likely header-only junk`;
    } else if (tooShort && !hasAnchors) {
      reason = `Source text short (${charCount} chars < ${SOFT_MIN}) with no anchor phrases - high hallucination risk`;
    } else {
      reason = 'No dispositive anchor phrases found';  // Should not reach here given isLow logic
    }

    // Return failure object - MUST have passed: false
    return {
      passed: false,  // <-- CRITICAL: enables `if (!pass0.passed)` check

      // Facts (all null for failed gate)
      holding: null,
      disposition: null,
      merits_reached: null,
      prevailing_party: null,
      practical_effect: null,
      evidence_quotes: [],
      // NOTE: case_type computed by deriveCaseType() - don't include here

      // Confidence - USE fact_extraction_confidence EVERYWHERE
      fact_extraction_confidence: 'low',
      low_confidence_reason: reason,

      // Metadata
      source_char_count: charCount,
      contains_anchor_terms: hasAnchors,

      // Review flags
      needs_manual_review: true,
      is_public: false
    };
  }

  // Source quality OK - return success object with metadata
  return {
    passed: true,
    source_char_count: charCount,
    contains_anchor_terms: hasAnchors
  };
}
```

**Key fixes from review:**
- Dropped loose `\b(is|are)\s+(affirmed|reversed...)` pattern (false positives)
- Returns object with `passed: true` + metadata on success (not null)
- Uses `fact_extraction_confidence` consistently

**Pass 0 Gating Logic (LENIENT mode - intentional decision):**

| Scenario | Anchors Found? | Result |
|----------|----------------|--------|
| < 200 chars | Any | ❌ FAIL (too short to be useful) |
| 200-599 chars | ❌ No | ❌ FAIL (short + no anchors = high risk) |
| 200-599 chars | ✅ Yes | ✅ PASS (anchors rescue short text) |
| ≥ 600 chars | ❌ No | ✅ PASS (long text has enough context) |
| ≥ 600 chars | ✅ Yes | ✅ PASS (best case) |

**Why lenient?** Anchor detection is imperfect (regex can't catch all valid phrasings). Long text (600+ chars) typically has enough context for GPT to extract facts correctly even without explicit "Held that..." phrasing. The self-consistency check (Phase 7) catches misinterpretations.

**If you want STRICT mode:** Change `isLow` to `(charCount < HARD_MIN) || !hasAnchors` to require anchors regardless of length. This reduces hallucinations but increases manual review load.

---

## Phase 2: Pass 1 - Fact Extraction

### Pass 1 Output Schema

```javascript
{
  // Core facts (EXTRACT DISPOSITION FIRST - drives everything else)
  disposition: "affirmed" | "reversed" | "vacated" | "remanded" |
               "dismissed" | "granted" | "denied" | "other" | null,
  merits_reached: boolean | null,   // KEY: prevents procedural→merits confusion
  holding: string | null,           // 1-2 sentences, neutral
  prevailing_party: "petitioner" | "respondent" | "partial" | "unclear" | null,
  practical_effect: string | null,  // 1 sentence

  // Grounding (REQUIRED for high/medium confidence)
  evidence_quotes: string[],        // 1-3 verbatim quotes, <=25 words each

  // Confidence - ALWAYS use fact_extraction_confidence
  fact_extraction_confidence: "high" | "medium" | "low",
  low_confidence_reason: string | null,

  // NOTE: case_type computed from disposition/merits_reached (see 6.12)
  // NOTE: vote_split and dissent_exists come from DB, NOT GPT (see 6.8)
  // NOTE: source_char_count/contains_anchor_terms injected from Pass 0
}
```

### Pass 1 Prompt

```javascript
const FACT_EXTRACTION_PROMPT = `
You are a SCOTUS fact extractor. Extract ONLY verifiable facts from the source text.

OUTPUT SCHEMA:
{
  "disposition": "affirmed|reversed|vacated|remanded|dismissed|granted|denied|other|null",
  "merits_reached": true/false/null,
  "holding": "1-2 sentences, neutral. What did the Court decide? If unclear, null.",
  "prevailing_party": "petitioner|respondent|partial|unclear|null",
  "practical_effect": "1 sentence. What changes? If unclear, null.",
  "evidence_quotes": ["verbatim quote 1 (<=25 words)", "quote 2", ...],
  "fact_extraction_confidence": "high|medium|low",
  "low_confidence_reason": "if not high, explain why"
}

NOTE: Do NOT output vote_split, dissent_exists, or case_type - those are computed from DB.

ANCHOR DETECTION - Accept any of:
- "Held that…" / "We hold…"
- "The judgment is affirmed/reversed/vacated/remanded…"
- "The Court dismisses… for lack of standing/jurisdiction…"
- "The application is granted/denied…"

EXTRACTION ORDER:
1. Find DISPOSITION first (affirmed/reversed/etc.)
2. Determine if MERITS were reached (procedural dismissal = false)
3. Extract HOLDING and PRACTICAL_EFFECT
4. Identify PREVAILING_PARTY (see rules below)

PREVAILING_PARTY RULES:
- "petitioner": Party seeking SCOTUS relief got favorable disposition
- "respondent": Party defending lower court ruling prevailed
- "partial": Split outcome (some claims won, some lost)
- "unclear": Use for vacated+remanded (procedural win, merits unclear),
             dismissed on standing/jurisdiction (no merits winner),
             or genuinely ambiguous outcomes

CONFIDENCE RULES:
- HIGH: disposition + holding present + ≥1 evidence quote with anchor token
- MEDIUM: disposition OR holding present + quotes present, but effect unclear
- LOW: missing anchors OR no quotes OR merits_reached unclear

GROUNDING REQUIREMENT:
- Every non-null claim MUST have a supporting quote
- For HIGH confidence, at least one quote must contain an anchor token
  (held, judgment, affirmed, reversed, vacated, dismissed, granted, denied)

RULES:
- Do NOT editorialize or add opinion
- Do NOT speculate beyond explicit source text
- Do NOT guess the holding - if unclear, return null
- If procedural (standing/jurisdiction), set merits_reached=false
`;
```

### Pass 1 Validator (Enforce Grounding)

```javascript
function validatePass1(facts, pass0Metadata) {
  const issues = [];

  // Inject Pass 0 metadata
  facts.source_char_count = pass0Metadata.source_char_count;
  facts.contains_anchor_terms = pass0Metadata.contains_anchor_terms;

  // Check: non-null facts MUST have quotes
  const claimFields = ['holding', 'disposition', 'practical_effect', 'prevailing_party', 'merits_reached'];
  const hasAnyClaim = claimFields.some(f => facts[f] !== null && facts[f] !== undefined);

  if (hasAnyClaim && (!facts.evidence_quotes || facts.evidence_quotes.length === 0)) {
    issues.push('Claims present but no evidence_quotes provided');
  }

  // Check: high/medium confidence requires quotes
  if (['high', 'medium'].includes(facts.fact_extraction_confidence) &&
      (!facts.evidence_quotes || facts.evidence_quotes.length === 0)) {
    issues.push('High/medium confidence requires evidence_quotes');
  }

  // Check: max 3 quotes
  if (facts.evidence_quotes && facts.evidence_quotes.length > 3) {
    issues.push('Too many quotes (max 3)');
  }

  // Check: quote word count (<=25 words each)
  // RULE: DO NOT truncate silently - that breaks "verbatim" grounding.
  // Instead: flag the issue and downgrade confidence.
  const MAX_QUOTE_WORDS = 25;
  let hasLongQuotes = false;
  if (facts.evidence_quotes) {
    facts.evidence_quotes.forEach((quote, i) => {
      const words = quote.trim().split(/\s+/);
      if (words.length > MAX_QUOTE_WORDS) {
        issues.push(`Quote ${i + 1} too long (${words.length} words > ${MAX_QUOTE_WORDS})`);
        hasLongQuotes = true;
      }
    });

    // If any quotes are too long, downgrade confidence and mark for review
    // DO NOT truncate - keep original quotes but flag as unverifiable
    if (hasLongQuotes) {
      facts.evidence_quotes_truncated = true;  // Flag for inspection
    }
  }

  // Check: HIGH requires at least one quote with anchor token
  if (facts.fact_extraction_confidence === 'high') {
    // Expanded anchor tokens - include all verb forms
    const anchorTokens = /\b(held|hold|holds|holding|judgment|affirm(ed|s|ing)?|revers(ed|es|ing)?|vacat(ed|es|ing)?|remand(ed|s|ing)?|dismiss(ed|es|al|ing)?|grant(ed|s|ing)?|den(ied|ies|ying)?)\b/i;
    const hasAnchorQuote = (facts.evidence_quotes || []).some(q => anchorTokens.test(q));
    if (!hasAnchorQuote) {
      issues.push('High confidence requires quote with anchor token');
    }
  }

  // Downgrade confidence if validation fails
  if (issues.length > 0) {
    return {
      ...facts,
      fact_extraction_confidence: 'low',
      low_confidence_reason: issues.join('; '),
      validation_issues: issues
    };
  }

  return facts;
}
```

---

## Phase 3: Pass 2 - Editorial Framing

### Pass 2 Prompt Builder

```javascript
function buildPass2Prompt(scotusCase, facts, variationInjection) {
  let constraints = '';

  // PROCEDURAL CASES: Lock who_wins/who_loses
  if (facts.merits_reached === false || facts.case_type === 'procedural') {
    constraints += `
PROCEDURAL CASE CONSTRAINT:
This is a procedural ruling (${facts.disposition || 'dismissal'}).
- who_wins MUST be: "Procedural ruling - no merits decision" or similar
- who_loses MUST be: "Case dismissed on procedural grounds" or similar
- Do NOT claim a substantive winner/loser
- summary_spicy should focus on WHY it was dismissed and who benefits from delay
`;
  }

  // CERT_STAGE CASES: Grant/deny cert language only
  if (facts.case_type === 'cert_stage') {
    constraints += `
CERT STAGE CONSTRAINT:
This is a cert-stage action (grant/deny of certiorari).
- Do NOT describe a merits outcome - no merits were decided
- who_wins/who_loses must reflect access to SCOTUS review ONLY
- Example who_wins: "Petitioner gains Supreme Court review"
- Example who_loses: "Respondent must defend at highest level"
- For cert denied: "Lower court ruling stands" NOT "X wins on the merits"
`;
  }

  // SHADOW_DOCKET CASES: Emergency order language
  if (facts.case_type === 'shadow_docket') {
    constraints += `
SHADOW DOCKET CONSTRAINT:
This is an emergency order (stay/injunction/application) - NOT a final merits ruling.
- Do NOT claim a final merits holding
- Focus on IMMEDIATE operational effect only
- who_wins/who_loses should reflect emergency posture
- Use language like "emergency relief granted/denied" NOT "Court rules..."
- Note this is temporary/expedited if applicable
`;
  }

  // DISPOSITION LOCK: Must appear verbatim
  if (facts.disposition) {
    constraints += `
DISPOSITION LOCK:
The disposition is "${facts.disposition}". This word MUST appear in summary_spicy.
`;
  }

  // Build the final prompt string
  const basePrompt = buildEditorialPrompt(scotusCase, facts, variationInjection);
  const fullPrompt = constraints ? `${constraints}\n\n${basePrompt}` : basePrompt;

  return fullPrompt;
}
```

### Pass 2 Drift Validation (Safety Net)

**Drift Severity Levels:**

| Level | Triggers | Outcome |
|-------|----------|---------|
| **HARD** | Procedural/cert/shadow mismatch (Pass 2 claims substantive winner when facts say no merits) | `flagAndSkip()` - clear editorial, needs review |
| **SOFT** | Inversion, disposition word missing, suspicious numbers, speculative tone | Keep editorial draft, but `is_public=false` + `needs_manual_review=true` |

**Rationale:** Hard drift = Pass 2 is making claims the facts explicitly contradict (false). Soft drift = Pass 2 may be stretching/embellishing but isn't directly contradicting (suspect). Keeping soft drift output helps reviewers see what went off the rails.

```javascript
/**
 * Validates that Pass 2 editorial doesn't contradict Pass 1 facts.
 * Returns severity: 'hard' (auto-flag+clear), 'soft' (flag+keep draft), or 'none' (clean)
 */
function validateNoDrift(facts, editorial) {
  const hardIssues = [];
  const softIssues = [];

  const practicalLower = (facts.practical_effect || '').toLowerCase();
  const summaryLower = (editorial.summary_spicy || '').toLowerCase();
  const whoWinsLower = (editorial.who_wins || '').toLowerCase();

  // ===== HARD DRIFT: Auto-flag + CLEAR editorial =====
  // These are factual contradictions where Pass 2 claims something Pass 1 explicitly denies

  // 1. Procedural mismatch (HARD) - claims substantive winner when no merits reached
  if (facts.merits_reached === false || facts.case_type === 'procedural') {
    if (!whoWinsLower.includes('procedural') && !whoWinsLower.includes('dismissed') &&
        !whoWinsLower.includes('no merits') && !whoWinsLower.includes('standing')) {
      hardIssues.push('Procedural mismatch: who_wins claims substantive winner');
    }
  }

  // 2. Cert stage mismatch (HARD) - claims merits outcome for cert grant/deny
  if (facts.case_type === 'cert_stage') {
    if (!whoWinsLower.includes('review') && !whoWinsLower.includes('cert') &&
        !whoWinsLower.includes('denied') && !whoWinsLower.includes('granted')) {
      hardIssues.push('Cert stage mismatch: who_wins claims merits outcome');
    }
  }

  // 3. Shadow docket mismatch (HARD) - claims final merits ruling for emergency order
  if (facts.case_type === 'shadow_docket') {
    if (summaryLower.includes('final') || summaryLower.includes('ruled on the merits')) {
      hardIssues.push('Shadow docket mismatch: summary claims final merits ruling');
    }
  }

  // ===== SOFT DRIFT: Flag but KEEP editorial draft for review =====
  // These are suspicious but not explicit contradictions

  // 4. Disposition word missing (SOFT) - editorial should mention the disposition
  if (facts.disposition && !summaryLower.includes(facts.disposition.toLowerCase())) {
    softIssues.push(`Disposition missing: "${facts.disposition}" not in summary`);
  }

  // 5. Meaning inversion (SOFT) - opposite words used
  const invertPairs = [
    ['harder', 'easier'],
    ['restricts', 'expands'],
    ['limits', 'broadens'],
    ['narrows', 'widens'],
    ['strengthens', 'weakens'],
    ['helps', 'hurts'],
    ['benefits', 'harms'],
  ];

  for (const [word1, word2] of invertPairs) {
    if (practicalLower.includes(word1) && summaryLower.includes(word2)) {
      softIssues.push(`Inversion: facts say "${word1}", editorial says "${word2}"`);
    }
    if (practicalLower.includes(word2) && summaryLower.includes(word1)) {
      softIssues.push(`Inversion: facts say "${word2}", editorial says "${word1}"`);
    }
  }

  // 6. Suspicious numbers (SOFT) - numbers in editorial not grounded in facts
  const meaningfulNumberPattern = /\$[\d,]+|\d+\s*%|\d+\s*(million|billion|years?)/gi;
  const numbersInSummary = (summaryLower.match(meaningfulNumberPattern) || [])
    .map(n => n.replace(/\s+/g, ' ').trim());
  const numbersInFacts = [
    ...(practicalLower.match(meaningfulNumberPattern) || []),
    ...((facts.holding || '').toLowerCase().match(meaningfulNumberPattern) || [])
  ].map(n => n.replace(/\s+/g, ' ').trim());

  for (const num of numbersInSummary) {
    if (!numbersInFacts.some(f => f.includes(num) || num.includes(f))) {
      softIssues.push(`Suspicious number: "${num}" not in facts`);
    }
  }

  // 7. Speculative language (SOFT) - hedged claims not in facts
  const speculativePatterns = ['could lead to', 'might result in', 'potentially'];
  for (const phrase of speculativePatterns) {
    if (summaryLower.includes(phrase) && !practicalLower.includes(phrase)) {
      softIssues.push(`Speculative language: "${phrase}"`);
    }
  }

  // Determine severity
  if (hardIssues.length > 0) {
    return {
      severity: 'hard',
      hasDrift: true,
      reason: hardIssues.join('; '),
      hardIssues,
      softIssues
    };
  }

  if (softIssues.length > 0) {
    return {
      severity: 'soft',
      hasDrift: true,
      reason: softIssues.join('; '),
      hardIssues: [],
      softIssues
    };
  }

  return {
    severity: 'none',
    hasDrift: false,
    reason: null,
    hardIssues: [],
    softIssues: []
  };
}
```

---

## Phase 4: Main Enrichment Flow

**File:** `scripts/scotus/enrich-scotus.js`

### Corrected Gating Skeleton

```javascript
async function enrichCase(scotusCase) {
  // PASS 0: Source quality gate
  const pass0 = checkSourceQuality(scotusCase);

  // Check if Pass 0 failed (returns object with fact_extraction_confidence)
  if (pass0 && !pass0.passed) {
    // Pass 0 returned a failure object
    return await flagAndSkip(scotusCase.id, pass0);
  }

  // Pass 0 succeeded - extract metadata for injection
  const pass0Metadata = {
    source_char_count: pass0.source_char_count,
    contains_anchor_terms: pass0.contains_anchor_terms
  };

  // PASS 1: Extract facts (temperature: 0 for deterministic extraction)
  // If consensus check enabled, runs twice and merges
  let facts = await extractFactsWithConsensus(scotusCase, pass0Metadata);

  // Validate + inject metadata (force low if ungrounded)
  facts = validatePass1(facts, pass0Metadata);

  // CRITICAL: Compute case_type BEFORE Pass 2 (constraints depend on it)
  facts.case_type = deriveCaseType(facts, scotusCase.case_name);

  if (facts.fact_extraction_confidence === 'low') {
    return await flagAndSkip(scotusCase.id, facts, supabase);
  }

  // PASS 2: Apply editorial framing with constraints (temperature: 0.7 for creativity)
  // applyEditorialTone() internally calls buildPass2Prompt(scotusCase, facts, variation)
  // IMPORTANT: facts.case_type is now set, so procedural/cert/shadow constraints will fire
  const editorial = await applyEditorialTone(scotusCase, facts);

  // Drift validation safety net
  const driftCheck = validateNoDrift(facts, editorial);

  if (driftCheck.severity === 'hard') {
    // HARD DRIFT: Clear editorial, flag for review
    return await flagAndSkip(scotusCase.id, {
      fact_extraction_confidence: 'low',
      low_confidence_reason: `Hard drift: ${driftCheck.reason}`,
      source_char_count: facts.source_char_count,
      contains_anchor_terms: facts.contains_anchor_terms,
      drift_detected: true,
      drift_reason: driftCheck.reason,
    }, supabase);
  }

  // Publish rules based on confidence + soft drift
  let isPublic = facts.fact_extraction_confidence === 'high';
  let needsReview = facts.fact_extraction_confidence === 'medium';

  if (driftCheck.severity === 'soft') {
    // SOFT DRIFT: Keep editorial draft, but force non-public + review
    isPublic = false;
    needsReview = true;
    // Attach soft drift info to facts for storage
    facts.drift_detected = true;
    facts.drift_reason = `Soft drift: ${driftCheck.reason}`;
  }

  // Pass scotusCase for DB field precedence (vote_split, dissent_authors) - avoids N+1 query
  await writeEnrichment(scotusCase.id, scotusCase, {
    ...facts,
    ...editorial,
    needs_manual_review: needsReview,
    is_public: isPublic
  }, supabase);

  return { success: true };
}
```

### Publishing Rules

| Confidence | Action |
|------------|--------|
| High | Enrich + `is_public=true` |
| Medium | Enrich but `is_public=false` + `needs_manual_review=true` |
| Low | Skip Pass 2 + `needs_manual_review=true` |

---

## Phase 5: Schema Migration

**File:** `migrations/XXX_scotus_two_pass.sql`

**Existing columns (from 066_scotus_cases.sql):**
- `who_wins`, `who_loses`, `summary_spicy`, `why_it_matters`, `dissent_highlights` ✅
- `evidence_anchors`, `is_public`, `enriched_at`, `prompt_version`, `vote_split` ✅
- `syllabus`, `opinion_excerpt`, `dissent_authors[]` ✅

**New columns needed:**

```sql
-- Migration: ADO-280 Two-Pass SCOTUS Enrichment
-- Adds Pass 1 fact extraction fields and lifecycle tracking

-- ============================================================================
-- 1. ENRICHMENT LIFECYCLE STATUS (CRITICAL for idempotency)
-- ============================================================================
-- IMPORTANT: Add WITHOUT default first, backfill, THEN set default.
-- If you add with DEFAULT, existing rows get 'pending' immediately,
-- making the backfill WHERE clause a no-op.

-- Step 1a: Add column WITHOUT default
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS enrichment_status TEXT
  CHECK (enrichment_status IN ('pending', 'enriched', 'flagged', 'failed'));

-- Step 1b: Backfill existing enriched cases (enriched_at IS NOT NULL)
UPDATE scotus_cases
SET enrichment_status = 'enriched'
WHERE enriched_at IS NOT NULL;

-- Step 1c: Backfill remaining rows as 'pending'
UPDATE scotus_cases
SET enrichment_status = 'pending'
WHERE enrichment_status IS NULL;

-- Step 1d: NOW set the default for future inserts
ALTER TABLE scotus_cases
ALTER COLUMN enrichment_status SET DEFAULT 'pending';

-- ============================================================================
-- 2. PASS 1 FACT EXTRACTION FIELDS (NEW - not in 066)
-- ============================================================================
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS disposition TEXT
  CHECK (disposition IN ('affirmed', 'reversed', 'vacated', 'remanded',
                         'dismissed', 'granted', 'denied', 'other')),
ADD COLUMN IF NOT EXISTS merits_reached BOOLEAN,
ADD COLUMN IF NOT EXISTS case_type TEXT
  CHECK (case_type IN ('merits', 'procedural', 'shadow_docket', 'cert_stage', 'unclear')),
ADD COLUMN IF NOT EXISTS holding TEXT,              -- NEW: neutral 1-2 sentence holding
ADD COLUMN IF NOT EXISTS prevailing_party TEXT
  CHECK (prevailing_party IN ('petitioner', 'respondent', 'partial', 'unclear')),
ADD COLUMN IF NOT EXISTS practical_effect TEXT,     -- NEW: 1 sentence practical effect
ADD COLUMN IF NOT EXISTS dissent_exists BOOLEAN,    -- NEW: boolean flag (supplement to dissent_authors[])
ADD COLUMN IF NOT EXISTS evidence_quotes JSONB NOT NULL DEFAULT '[]'::jsonb;  -- NEW: verbatim quotes

-- ============================================================================
-- 3. CONFIDENCE AND REVIEW TRACKING
-- ============================================================================
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS fact_extraction_confidence TEXT
  CHECK (fact_extraction_confidence IN ('high', 'medium', 'low')),
ADD COLUMN IF NOT EXISTS low_confidence_reason TEXT,
ADD COLUMN IF NOT EXISTS needs_manual_review BOOLEAN DEFAULT false;

-- ============================================================================
-- 4. SOURCE QUALITY TRACKING (debugging)
-- ============================================================================
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS source_char_count INTEGER,
ADD COLUMN IF NOT EXISTS contains_anchor_terms BOOLEAN;

-- ============================================================================
-- 5. DRIFT DETECTION + ERROR TRACKING
-- ============================================================================
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS drift_detected BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS drift_reason TEXT,
ADD COLUMN IF NOT EXISTS last_error TEXT;  -- For system/runtime errors (separate from confidence issues)

-- ============================================================================
-- 5b. EVIDENCE ANCHORS TYPE DECISION
-- ============================================================================
-- evidence_anchors is already defined in 066 as TEXT[] (nullable).
-- For clearing consistency, we accept either null or [].
-- The CLEAR_DEFAULTS constant uses [] for safety.
--
-- NOTE: If you want to enforce NOT NULL DEFAULT '{}', run:
-- ALTER TABLE scotus_cases ALTER COLUMN evidence_anchors SET NOT NULL;
-- ALTER TABLE scotus_cases ALTER COLUMN evidence_anchors SET DEFAULT '{}';
-- But this is OPTIONAL - nullable TEXT[] works fine.

-- ============================================================================
-- 6. MANUAL REVIEW TRACKING
-- ============================================================================
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS manual_reviewed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS manual_review_note TEXT;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scotus_needs_review
ON scotus_cases (needs_manual_review)
WHERE needs_manual_review = true;

CREATE INDEX IF NOT EXISTS idx_scotus_drift
ON scotus_cases (drift_detected)
WHERE drift_detected = true;

-- Index for run selection (critical for idempotency)
CREATE INDEX IF NOT EXISTS idx_scotus_enrichment_status
ON scotus_cases (enrichment_status)
WHERE enrichment_status IN ('pending', 'failed');
```

---

## Phase 6: Canonical Definitions

### 6.0 Field Constants (SINGLE SOURCE OF TRUTH)

```javascript
/**
 * CANONICAL FIELD LISTS - Keep synced with scotus_cases schema
 * Any field added to the schema MUST be added to the appropriate list.
 */

// Pass 1 fact extraction fields (written by extractFacts)
const FACT_FIELDS = [
  'disposition',
  'merits_reached',
  'case_type',
  'holding',
  'prevailing_party',
  'practical_effect',
  'evidence_quotes',
  // NOTE: vote_split and dissent_exists come from DB, not GPT (see 6.8)
];

// Pass 2 editorial fields (written by applyEditorialTone)
const EDITORIAL_FIELDS = [
  'ruling_impact_level',
  'ruling_label',
  'who_wins',
  'who_loses',
  'summary_spicy',
  'why_it_matters',
  'dissent_highlights',
  'evidence_anchors',
];

// All enrichment fields that should be cleared on flag/fail
const ALL_ENRICHMENT_FIELDS = [...FACT_FIELDS, ...EDITORIAL_FIELDS];

/**
 * CLEAR DEFAULTS - Per-field defaults for clearing (respects NOT NULL constraints)
 *
 * DB Types (from migration):
 * - evidence_quotes: JSONB NOT NULL DEFAULT '[]'  → clear with []
 * - evidence_anchors: TEXT[] nullable             → clear with null (or [] if NOT NULL)
 * - All other enrichment fields: nullable         → clear with null
 */
const CLEAR_DEFAULTS = {
  evidence_quotes: [],     // JSONB NOT NULL - must use empty array
  evidence_anchors: [],    // TEXT[] - use empty array for safety (works either way)
  // All others default to null (handled in buildClearPayload)
};

/**
 * Helper: build a payload that clears all enrichment fields
 * Uses CLEAR_DEFAULTS for NOT NULL arrays, null for everything else
 */
function buildClearPayload() {
  const payload = {};
  for (const field of ALL_ENRICHMENT_FIELDS) {
    payload[field] = CLEAR_DEFAULTS[field] ?? null;
  }
  return payload;
}

/**
 * DB WRITE SAFETY: Column whitelist
 *
 * Runtime objects may contain extra fields (validation_issues, passed,
 * evidence_quotes_truncated, consistency_check_failed, etc.) that
 * don't exist in the DB schema. Sending them to Supabase will fail.
 *
 * ALWAYS use sanitizeForDB() before any .update() call.
 */
const DB_COLUMNS = new Set([
  // Enrichment fields
  ...FACT_FIELDS,
  ...EDITORIAL_FIELDS,
  // Status/metadata
  'enrichment_status', 'enriched_at', 'is_public', 'needs_manual_review',
  'fact_extraction_confidence', 'low_confidence_reason', 'last_error',
  'source_char_count', 'contains_anchor_terms',
  'drift_detected', 'drift_reason',
  'manual_reviewed_at', 'manual_review_note',
  'prompt_version', 'updated_at',
  // DB-only fields (not from GPT)
  'vote_split', 'dissent_exists',
]);

function sanitizeForDB(payload) {
  const clean = {};
  for (const [key, value] of Object.entries(payload)) {
    if (DB_COLUMNS.has(key)) {
      clean[key] = value;
    }
  }
  return clean;
}
```

### 6.0b Canonical Field Map

| Field | Source | Purpose |
|-------|--------|---------|
| **Pass 1 Facts** |||
| `disposition` | GPT | affirmed/reversed/vacated/etc. |
| `merits_reached` | GPT | true/false/null |
| `holding` | GPT | 1-2 sentence neutral statement |
| `prevailing_party` | GPT | petitioner/respondent/partial/unclear |
| `practical_effect` | GPT | 1 sentence real-world impact |
| `evidence_quotes` | GPT | Verbatim quotes (max 3, ≤25 words each) |
| **Computed (not GPT)** |||
| `case_type` | `deriveCaseType()` | merits/procedural/cert_stage/shadow_docket/unclear |
| `vote_split` | CourtListener DB | "6-3", "9-0", etc. (DB wins if non-null) |
| `dissent_exists` | Computed | `= (dissent_authors?.length > 0)` |
| **Pass 2 Editorial** |||
| `ruling_impact_level` | GPT | 0-5 scale |
| `ruling_label` | GPT | "Constitutional Crisis", etc. |
| `who_wins` / `who_loses` | GPT | Specific beneficiary/victim |
| `summary_spicy` | GPT | 3-4 sentence editorial |
| `why_it_matters` | GPT | Systemic implications |
| `dissent_highlights` | GPT | Key dissent warning |
| `evidence_anchors` | GPT | Citation references (UI display) |
| **Confidence/Status** |||
| `fact_extraction_confidence` | Validator | high/medium/low |
| `low_confidence_reason` | Validator | Why not high (confidence issues) |
| `last_error` | Runtime | GPT/network errors (not confidence) |
| **Runtime-Only (NOT in DB)** |||
| `passed` | Pass 0 | Gate result - DO NOT write to DB |
| `validation_issues` | Validator | Issue list - DO NOT write to DB |
| `consistency_check_failed` | Consensus | Mismatch flag - DO NOT write to DB |
| `evidence_quotes_truncated` | Validator | Truncation flag - DO NOT write to DB |

### 6.1 Case Lifecycle & `enrichment_status`

| Status | Meaning | Next Run? | `is_public` | `enriched_at` |
|--------|---------|-----------|-------------|---------------|
| `pending` | Never attempted | ✅ Yes | `false` | `null` |
| `enriched` | Successfully enriched | ❌ No | `true` (high) or `false` (medium) | Set |
| `flagged` | Low confidence / drift | ❌ No | `false` | `null` |
| `failed` | GPT error / validation error | ✅ Yes (retry) | `false` | `null` |

### 6.2 `flagAndSkip()` Definition

```javascript
/**
 * Marks a case as flagged (low confidence) - will NOT be retried automatically.
 *
 * CRITICAL CONTRACT:
 * - Sets needs_manual_review=true, is_public=false
 * - Writes confidence + reason + source metadata
 * - CLEARS all enrichment fields (no stale data leakage)
 * - Clears enriched_at (it means "last successful publishable enrichment")
 *
 * @param {number} caseId - The scotus_case.id
 * @param {object} details - Must have fact_extraction_confidence, low_confidence_reason
 * @param {object} supabase - Supabase client
 * @returns {{ skipped: true, reason: string }}
 */
async function flagAndSkip(caseId, details, supabase) {
  const payload = {
    // Clear all enrichment fields first
    ...buildClearPayload(),

    // Status
    enrichment_status: 'flagged',
    enriched_at: null,

    // Confidence tracking
    fact_extraction_confidence: details.fact_extraction_confidence,
    low_confidence_reason: details.low_confidence_reason,

    // Source quality metadata (for debugging)
    source_char_count: details.source_char_count,
    contains_anchor_terms: details.contains_anchor_terms,

    // Drift tracking (if applicable)
    drift_detected: details.drift_detected || false,
    drift_reason: details.drift_reason || null,

    // Review flags
    needs_manual_review: true,
    is_public: false,

    // Versioning
    prompt_version: 'v2-ado280-flagged',
    updated_at: new Date().toISOString(),
  };

  // CRITICAL: sanitize before DB write to avoid unknown column errors
  const { error } = await supabase
    .from('scotus_cases')
    .update(sanitizeForDB(payload))
    .eq('id', caseId);

  if (error) throw error;

  console.log(`[flagAndSkip] Case ${caseId} flagged: ${details.low_confidence_reason}`);
  return { skipped: true, reason: details.low_confidence_reason || details.drift_reason || 'flagged' };
}
```

### 6.3 `markFailed()` Definition

```javascript
/**
 * Marks a case as failed (will be retried on next run).
 *
 * CRITICAL CONTRACT:
 * - Sets is_public=false (prevents stale public data)
 * - Clears editorial fields (Pass 2 may have partial data)
 * - KEEPS Pass 1 fields if they exist (failure may be in Pass 2 only)
 * - Clears enriched_at
 * - Does NOT set needs_manual_review (transient failures don't need human attention)
 * - Does NOT use low_confidence_reason (that's for confidence issues, not errors)
 *
 * @param {number} caseId - The scotus_case.id
 * @param {string} errorMessage - Error description
 * @param {object} supabase - Supabase client
 */
async function markFailed(caseId, errorMessage, supabase) {
  // Build payload that clears only editorial fields (keep Pass 1 if valid)
  const editorialClear = {};
  for (const field of EDITORIAL_FIELDS) {
    editorialClear[field] = CLEAR_DEFAULTS[field] ?? null;
  }

  const payload = {
    ...editorialClear,
    enrichment_status: 'failed',
    enriched_at: null,
    last_error: errorMessage,  // Use dedicated error field, NOT low_confidence_reason
    is_public: false,
    needs_manual_review: false,  // Transient errors don't need human review - will auto-retry
    updated_at: new Date().toISOString(),
  };

  // CRITICAL: sanitize before DB write
  const { error } = await supabase
    .from('scotus_cases')
    .update(sanitizeForDB(payload))
    .eq('id', caseId);

  if (error) throw error;
  console.error(`[markFailed] Case ${caseId}: ${errorMessage}`);
}
```

**Field semantics:**
| Field | Used For | Example |
|-------|----------|---------|
| `low_confidence_reason` | Confidence issues (short text, no anchors, consensus fail) | "Source text too short (481 chars)" |
| `last_error` | System/runtime errors (GPT timeout, JSON parse, network) | "OpenAI rate limit exceeded" |
| `drift_reason` | Drift detection failures | "Inversion: Pass 1 says 'harder', Pass 2 says 'easier'" |

**Review queue rules:**
| Scenario | `needs_manual_review` | Rationale |
|----------|----------------------|-----------|
| Low confidence (flagged) | `true` | Human must decide if enrichable |
| Medium confidence (enriched) | `true` | Human should verify before publish |
| High confidence (enriched) | `false` | Auto-publish |
| Drift detected (flagged) | `true` | Human must review |
| System error (failed) | `false` | Will auto-retry, no human needed |

### 6.4 `writeEnrichment()` Definition

```javascript
/**
 * Writes successful enrichment (high or medium confidence).
 *
 * CRITICAL CONTRACT:
 * - Overwrites all fact + editorial fields atomically
 * - Sets timestamps deterministically
 * - Applies DB field precedence rules (see 6.8)
 * - NO re-query: scotusCase already has vote_split/dissent_authors from getCasesToEnrich()
 *
 * @param {number} caseId - The scotus_case.id
 * @param {object} scotusCase - Original case object from getCasesToEnrich() (has vote_split, dissent_authors)
 * @param {object} data - Merged facts + editorial output
 * @param {object} supabase - Supabase client
 */
async function writeEnrichment(caseId, scotusCase, data, supabase) {
  // NO RE-QUERY: scotusCase already has vote_split and dissent_authors
  // This avoids N+1 queries - run selection fetches these fields upfront

  const payload = {
    // Status
    enrichment_status: 'enriched',
    enriched_at: new Date().toISOString(),

    // Pass 1 facts
    disposition: data.disposition,
    merits_reached: data.merits_reached,
    case_type: data.case_type,  // Already computed before this call
    holding: data.holding,
    prevailing_party: data.prevailing_party,
    practical_effect: data.practical_effect,
    evidence_quotes: data.evidence_quotes || [],

    // DB PRECEDENCE: vote_split from DB wins if non-null
    vote_split: scotusCase.vote_split || null,  // From original query, not GPT
    // DB PRECEDENCE: dissent_exists computed from DB, not GPT
    dissent_exists: (scotusCase.dissent_authors?.length || 0) > 0,

    // Confidence
    fact_extraction_confidence: data.fact_extraction_confidence,
    low_confidence_reason: data.low_confidence_reason || null,

    // Metadata
    source_char_count: data.source_char_count,
    contains_anchor_terms: data.contains_anchor_terms,

    // Pass 2 editorial
    ruling_impact_level: data.ruling_impact_level,
    ruling_label: data.ruling_label,
    who_wins: data.who_wins,
    who_loses: data.who_loses,
    summary_spicy: data.summary_spicy,
    why_it_matters: data.why_it_matters,
    dissent_highlights: data.dissent_highlights,
    evidence_anchors: data.evidence_anchors || [],

    // Drift detection
    drift_detected: data.drift_detected || false,
    drift_reason: data.drift_reason || null,

    // Review flags
    needs_manual_review: data.needs_manual_review,
    is_public: data.is_public,

    // Versioning
    prompt_version: 'v2-ado280',
    updated_at: new Date().toISOString(),
  };

  // CRITICAL: sanitize before DB write to avoid unknown column errors
  const { error } = await supabase
    .from('scotus_cases')
    .update(sanitizeForDB(payload))
    .eq('id', caseId);

  if (error) throw error;
  console.log(`[writeEnrichment] Case ${caseId} enriched (public: ${data.is_public})`);
}
```

**Caller must pass scotusCase:**
```javascript
// In enrichCase():
await writeEnrichment(scotusCase.id, scotusCase, { ...facts, ...editorial, ... }, supabase);
```

### 6.5 Medium Confidence Behavior (Option A)

**Decision:** Store Pass 2 outputs for medium confidence, but keep non-public.

| Confidence | Pass 2 Output | `is_public` | `needs_manual_review` | Reviewer Experience |
|------------|---------------|-------------|----------------------|---------------------|
| High | ✅ Stored | `true` | `false` | Published automatically |
| Medium | ✅ Stored | `false` | `true` | Sees draft, can approve/reject |
| Low | ❌ Not run | `false` | `true` | Sees only metadata, must re-enrich |

**API Filter Rule:** All queries MUST filter `is_public = true` for public-facing endpoints.

```javascript
// CORRECT: Public API endpoint
const { data } = await supabase
  .from('scotus_cases')
  .select('*')
  .eq('is_public', true);  // REQUIRED

// WRONG: Leaks non-public data
const { data } = await supabase
  .from('scotus_cases')
  .select('*');  // NEVER DO THIS IN PUBLIC API
```

### 6.5b Publish Rule Definition (Truth-First)

**A case is eligible for `is_public = true` only if ALL of:**

| Condition | Why |
|-----------|-----|
| `fact_extraction_confidence = 'high'` | Facts are well-grounded |
| `enrichment_status = 'enriched'` | Passed all validation |
| `drift_detected = false` | Editorial didn't contradict facts |
| Consensus check passed (if enabled) | Pass 1 was deterministic |

**Additionally recommended (strong truth gate):**
- `contains_anchor_terms = true` OR at least one `evidence_quote` contains an anchor phrase

**Code implementation:**
```javascript
function isPublishEligible(caseData) {
  // Required conditions
  if (caseData.fact_extraction_confidence !== 'high') return false;
  if (caseData.enrichment_status !== 'enriched') return false;
  if (caseData.drift_detected === true) return false;
  if (caseData.consistency_check_failed === true) return false;

  // Optional but recommended: anchor grounding
  // Uncomment for stricter truth-first mode:
  // if (!caseData.contains_anchor_terms) return false;

  return true;
}
```

**Manual override:** Reviewers can approve non-eligible cases via `approveCase()` after human verification.

### 6.6 Manual Review Approval Path

**Migration addition:**
```sql
ALTER TABLE scotus_cases
ADD COLUMN IF NOT EXISTS manual_reviewed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS manual_review_note TEXT;
```

**Approve a flagged/medium case:**
```javascript
async function approveCase(caseId, reviewNote, supabase) {
  const { error } = await supabase
    .from('scotus_cases')
    .update({
      needs_manual_review: false,
      is_public: true,
      manual_reviewed_at: new Date().toISOString(),
      manual_review_note: reviewNote || 'Approved by manual review',
    })
    .eq('id', caseId);

  if (error) throw error;
}
```

**Reject and re-queue a case:**
```javascript
async function rejectAndRequeue(caseId, reviewNote, supabase) {
  const { error } = await supabase
    .from('scotus_cases')
    .update({
      ...buildClearPayload(),
      enrichment_status: 'pending',  // Re-queue for enrichment
      enriched_at: null,
      needs_manual_review: false,
      is_public: false,
      manual_reviewed_at: new Date().toISOString(),
      manual_review_note: reviewNote || 'Rejected and re-queued',
    })
    .eq('id', caseId);

  if (error) throw error;
}
```

### 6.6b Manual Review Playbook

**When a case lands in review queue (`needs_manual_review=true`):**

| Case Type | What Reviewer Checks | Actions Available |
|-----------|---------------------|-------------------|
| **Low confidence** | Is source actually unusable? Can anchors be found manually? | Approve (publish) or Re-queue (re-enrich with updated source) |
| **Medium confidence** | Are facts correct? Is editorial appropriate? | Approve (publish), Edit & approve, or Reject (re-queue) |
| **Soft drift** | Is the drift a real problem or false positive? | Approve (editorial is fine), Edit editorial, or Reject |
| **Hard drift** | Why did Pass 2 contradict facts? | Re-queue (will re-run enrichment) |

**Fields reviewer may edit:**
- Fact fields: `holding`, `disposition`, `merits_reached`, `practical_effect`, `prevailing_party`
- Editorial fields: `who_wins`, `who_loses`, `summary_spicy`, `why_it_matters`
- Classification: `case_type` (override computed value if wrong)

**"Review complete" means:**
```sql
-- Approve and publish
UPDATE scotus_cases SET
  needs_manual_review = false,
  is_public = true,
  fact_extraction_confidence = 'high',  -- Human-verified
  manual_reviewed_at = NOW(),
  manual_review_note = 'Verified by [reviewer]'
WHERE id = <case_id>;

-- Or reject and re-queue
UPDATE scotus_cases SET
  enrichment_status = 'pending',
  needs_manual_review = false,
  is_public = false,
  manual_reviewed_at = NOW(),
  manual_review_note = 'Rejected: [reason]'
WHERE id = <case_id>;
```

**Re-running Pass 2 after manual fact edits:**
If reviewer corrects fact fields, they can either:
1. Hand-edit editorial fields to match (simpler, no cost)
2. Re-queue with `enrichment_status='pending'` to re-run full pipeline (costs tokens)

For MVP, option 1 is sufficient. Option 2 requires adding a "fact-locked re-enrichment" mode (future).

### 6.7 Drift Outcome Definition

**Decision:** Drift handling depends on severity (see Phase 3 drift validation).

| Drift Severity | Editorial Fields | Outcome |
|----------------|------------------|---------|
| **HARD** | CLEARED via `flagAndSkip()` | `enrichment_status='flagged'`, reviewer must re-queue |
| **SOFT** | KEPT (draft for review) | `enrichment_status='enriched'` but `is_public=false`, `needs_manual_review=true` |

| On Hard Drift | Action |
|---------------|--------|
| `enrichment_status` | `'flagged'` |
| `is_public` | `false` |
| `needs_manual_review` | `true` |
| `drift_detected` | `true` |
| `drift_reason` | Specific mismatch details |
| Editorial fields | **CLEARED** |
| `enriched_at` | `null` |

| On Soft Drift | Action |
|---------------|--------|
| `enrichment_status` | `'enriched'` (draft stored) |
| `is_public` | `false` |
| `needs_manual_review` | `true` |
| `drift_detected` | `true` |
| `drift_reason` | Specific mismatch details |
| Editorial fields | **KEPT** (reviewer can inspect/approve) |
| `enriched_at` | Set (it was enriched, just not publishable) |

**Rationale:** Hard drift means factual contradiction - editorial is wrong and shouldn't persist. Soft drift means potential embellishment - keeping the draft helps reviewers see what went off the rails and decide if it's acceptable.

### 6.8 DB Field Precedence Rules

| Field | Precedence | Rationale |
|-------|------------|-----------|
| `vote_split` | **DB wins** if non-null | CourtListener data more reliable than GPT |
| `dissent_exists` | **Computed from `dissent_authors[]`** | `= (dissent_authors?.length > 0)` - never ask GPT |
| `majority_author` | **DB only** | From CourtListener, not enrichment field |
| `dissent_authors[]` | **DB only** | From CourtListener, not enrichment field |

### 6.9 Run Selection Query

> **⚠️ v1 ONLY - DEPRECATED**
>
> This query is for v1 (syllabus-based) enrichment.
> **For v2 (full opinion), see Section 3a in "Full Opinion Architecture" above.**
> The v2 query:
> - Uses `!left` JOIN to `scotus_opinions`
> - Removes `.or(syllabus/excerpt)` filter (Pass 0 handles that)
> - Flattens joined opinion text robustly

```javascript
// v1 ONLY - DO NOT USE FOR v2
async function getCasesToEnrich(limit = 10, supabase) {
  const { data, error } = await supabase
    .from('scotus_cases')
    .select('id, case_name, syllabus, opinion_excerpt, term, decided_at, vote_split, majority_author, dissent_authors, issue_area')
    .in('enrichment_status', ['pending', 'failed'])
    .or('syllabus.not.is.null,opinion_excerpt.not.is.null')  // v2 REMOVES THIS
    .order('decided_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}
```

### 6.10 GPT Call Wrapper

```javascript
async function callGPTWithRetry(messages, { temperature = 0, maxRetries = 1 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        response_format: { type: 'json_object' },
        temperature,
        max_tokens: 1500
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('Empty GPT response');

      return JSON.parse(content);
    } catch (err) {
      console.warn(`[GPT] Attempt ${attempt + 1} failed:`, err.message);
      if (attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}
```

### 6.11 Failure Handling Matrix

| Failure Type | Function | Status After | Editorial Cleared? |
|--------------|----------|--------------|-------------------|
| Pass 0 fails | `flagAndSkip()` | `flagged` | ✅ Yes (all fields) |
| Pass 1 validation fails | `flagAndSkip()` | `flagged` | ✅ Yes (all fields) |
| Pass 1 consensus fails | `flagAndSkip()` | `flagged` | ✅ Yes (all fields) |
| Pass 2 validation fails | `markFailed()` | `failed` | ✅ Yes (editorial only) |
| **Hard** drift detected | `flagAndSkip()` | `flagged` | ✅ Yes (all fields) |
| **Soft** drift detected | `writeEnrichment()` | `enriched` | ❌ No (kept for review) |
| GPT error / network | `markFailed()` | `failed` | ✅ Yes (editorial only) |

### 6.12 `deriveCaseType()` - Deterministic Computation

**Why compute, not ask GPT?** `case_type` is derivable from `disposition` + `merits_reached` + case name patterns. Asking GPT adds ambiguity and wastes tokens.

```javascript
/**
 * Shadow docket detection patterns (MVP)
 * Matches emergency orders, stays, injunctions that bypass full briefing
 */
const SHADOW_DOCKET_PATTERNS = [
  /application for stay/i,
  /emergency application/i,
  /motion for injunctive relief/i,
  /application to vacate stay/i,
  /stay pending appeal/i,
  /application for injunction/i,
  /motion to stay/i,
  /emergency motion/i,
  /application for recall/i,  // Recall of mandate
];

function isShadowDocket(caseName) {
  return SHADOW_DOCKET_PATTERNS.some(p => p.test(caseName || ''));
}

/**
 * Derives case_type from disposition, merits_reached, and case name.
 * NEVER ask GPT for case_type - compute it deterministically.
 *
 * @param {object} facts - Pass 1 output with disposition and merits_reached
 * @param {string} caseName - Case name for shadow docket detection
 * @returns {string} One of: 'merits', 'procedural', 'cert_stage', 'shadow_docket', 'unclear'
 */
function deriveCaseType({ disposition, merits_reached }, caseName = '') {
  // FIRST: Check shadow docket by case name (takes priority)
  if (isShadowDocket(caseName)) {
    return 'shadow_docket';
  }

  // Cert stage: grant/deny cert (no merits decided)
  if (disposition === 'granted' || disposition === 'denied') {
    // Distinguish cert grants (granted) from final judgments (affirmed/reversed)
    // "granted" without merits_reached=true is cert stage
    if (merits_reached !== true) {
      return 'cert_stage';
    }
  }

  // Procedural: explicit merits_reached=false OR dismissal dispositions
  if (merits_reached === false) {
    return 'procedural';
  }
  if (disposition === 'dismissed') {
    return 'procedural';  // Standing/jurisdiction/mootness dismissals
  }

  // Merits: affirmed/reversed are clear merits indicators
  if (['affirmed', 'reversed'].includes(disposition)) {
    if (merits_reached === true || merits_reached === null) {
      return 'merits';
    }
  }

  // TRAP: vacated/remanded is often NOT a merits ruling
  // Many are procedural cleanups ("go re-evaluate under X standard")
  // Truth-first: require explicit merits_reached=true, otherwise unclear
  if (['vacated', 'remanded'].includes(disposition)) {
    if (merits_reached === true) {
      return 'merits';  // Explicit merits confirmation
    }
    // Default to unclear for vacated/remanded without explicit merits
    // This caps publishability and forces manual review
    return 'unclear';
  }

  return 'unclear';
}
```

**Usage in pipeline:**
```javascript
// AFTER validatePass1(), BEFORE Pass 2:
facts.case_type = deriveCaseType(facts, scotusCase.case_name);
```

**Shadow docket detection notes:**
- Pattern matching on case name catches most emergency orders
- Some shadow docket cases may have normal-looking names (missed by pattern)
- If pattern doesn't match but disposition is stay-related, might still be shadow docket
- Future enhancement: add CourtListener metadata flags if available

### 6.13 Status Transitions (Authoritative)

```
┌─────────┐
│ pending │ ←── Initial state (new cases, or after rejectAndRequeue)
└────┬────┘
     │ Run enrichment
     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Enrichment Outcomes                       │
├─────────────────┬─────────────────┬─────────────────────────┤
│                 │                 │                         │
▼                 ▼                 ▼                         │
┌──────────┐  ┌────────┐    ┌────────┐                        │
│ enriched │  │ flagged │    │ failed │ ───────────────────────┘
└────┬─────┘  └────┬────┘    └────┬───┘        (retry)
     │             │              │
     │             │              └── Transient error, auto-retry on next run
     │             │
     │             └── Low confidence/drift, needs human decision
     │
     └── Success (high=public, medium=needs_review)

Manual Actions:
- flagged → pending (via rejectAndRequeue)
- flagged → public (via approveCase)
- medium+enriched → public (via approveCase)
```

**Transition rules:**
| From | To | Trigger |
|------|----|---------|
| `pending` | `enriched` | High/medium confidence Pass 1+2 success |
| `pending` | `flagged` | Low confidence OR drift detected |
| `pending` | `failed` | GPT error, network error, validation crash |
| `failed` | `enriched` | Retry succeeds |
| `failed` | `flagged` | Retry hits low confidence |
| `failed` | `failed` | Retry fails again |
| `flagged` | `pending` | `rejectAndRequeue()` (human action) |
| `flagged` | `enriched` | NOT ALLOWED (must go through pending) |

**`flagged` is a terminal state for automation** - only humans can move it.

---

## Phase 7: Accuracy Safeguards

### 7.1 Pass 1 Self-Consistency Check

**Problem:** Pass 1 can be confidently wrong. Starbucks showed the model can invert practical_effect even when the syllabus exists.

**Solution:** Run Pass 1 twice at temp=0, require agreement on critical fields. Mismatch → force `low` confidence.

**Consensus fields (MUST match):**
- `disposition`
- `merits_reached`
- `prevailing_party`

**NOTE:** `case_type` is NOT in consensus fields because GPT doesn't output it - we compute it from disposition+merits_reached via `deriveCaseType()`. Consensus compares raw GPT outputs only.

```javascript
// Only compare fields GPT actually outputs
const CONSENSUS_FIELDS = ['disposition', 'merits_reached', 'prevailing_party'];

/**
 * Compares two Pass 1 outputs and merges them.
 * If critical fields mismatch, force low confidence.
 */
function consensusMerge(a, b) {
  const mismatches = [];

  for (const field of CONSENSUS_FIELDS) {
    // Normalize null/undefined for comparison
    const aVal = a?.[field] ?? null;
    const bVal = b?.[field] ?? null;
    if (aVal !== bVal) {
      mismatches.push(`${field}: "${aVal}" vs "${bVal}"`);
    }
  }

  if (mismatches.length > 0) {
    return {
      ...a,
      fact_extraction_confidence: 'low',
      low_confidence_reason: `Pass 1 consensus mismatch: ${mismatches.join(', ')}`,
      consistency_check_failed: true,
      needs_manual_review: true,
    };
  }

  // If they match on key fields, prefer the one with better quotes/holding filled
  const aQuotes = a.evidence_quotes?.length || 0;
  const bQuotes = b.evidence_quotes?.length || 0;
  return aQuotes >= bQuotes ? a : b;
}

/**
 * Runs Pass 1 twice and merges with consensus check.
 */
async function extractFactsWithConsensus(scotusCase, pass0Metadata) {
  const facts1 = await callGPTWithRetry(buildPass1Messages(scotusCase), { temperature: 0 });
  const facts2 = await callGPTWithRetry(buildPass1Messages(scotusCase), { temperature: 0 });

  const merged = consensusMerge(facts1, facts2);
  return validatePass1(merged, pass0Metadata);
}
```

**Cost:** 2x Pass 1 tokens (~$0.0008 → ~$0.0016 per case). Worth it for accuracy.

**CLI flag:** `--skip-consensus` to disable (not recommended).

### 7.2 Confidence Cap When No Anchors

**Problem:** If `contains_anchor_terms=false` (allowed for long text in lenient mode), Pass 1 might still claim `high` confidence. We shouldn't trust that.

**Implementation in `validatePass1()`:**

```javascript
function validatePass1(facts, pass0Metadata) {
  // ... other validation ...

  // Cap confidence if no anchor terms in source
  if (!pass0Metadata.contains_anchor_terms &&
      facts.fact_extraction_confidence === 'high') {
    facts = {
      ...facts,
      fact_extraction_confidence: 'medium',
      low_confidence_reason: (facts.low_confidence_reason || '') +
        '; Capped to medium (no anchor terms in source)',
    };
  }

  return facts;
}
```

---

## Code Review Fixes Applied (Round 8 - FINAL)

### Round 8 Fixes (This Round - "Last Round")

| Issue | Fix |
|-------|-----|
| **DB write safety** | Added `DB_COLUMNS` whitelist + `sanitizeForDB()` to prevent unknown column errors |
| **Canonical field map** | Added 6.0b with source/purpose for every field including runtime-only fields |
| **vacated/remanded trap** | Now requires explicit `merits_reached=true` for merits classification; defaults to `unclear` |
| **Drift severity recalibrated** | Inversion, disposition missing, suspicious numbers → SOFT (keep draft); only procedural/cert/shadow mismatch → HARD |
| **Manual review playbook** | Added 6.6b defining reviewer actions, editable fields, and "review complete" SQL |

### Round 7 Fixes (Previous Round)

| Issue | Fix |
|-------|-----|
| **case_type not set before Pass 2** | Compute `deriveCaseType()` immediately after `validatePass1()`, before Pass 2 |
| **Consensus check includes case_type** | Removed from `CONSENSUS_FIELDS` - GPT doesn't output it |
| **Shadow docket detection "future"** | Implemented `SHADOW_DOCKET_PATTERNS` + `isShadowDocket()` in `deriveCaseType()` |
| **Drift severity levels undefined** | Added hard vs soft severity in `validateNoDrift()` |
| **Anchor token regex too narrow** | Expanded to include all verb forms |
| **Acceptance criteria "always public"** | Fixed to confidence-gated publishing |
| **Publish rule undefined** | Added explicit `isPublishEligible()` definition (6.5b) |

### Round 6 Fixes

| Issue | Fix |
|-------|-----|
| **Drift behavior contradiction** | Drift now uses `flagAndSkip()` - CLEARS editorial fields (6.7 updated) |
| **Pass 1 asks GPT for DB-only fields** | Removed `vote_split`, `dissent_exists`, `case_type` from GPT schema |
| **cert_stage/shadow_docket constraints missing** | Added Pass 2 constraints in `buildPass2Prompt()` |
| **Run selection query inconsistency** | Deprecated `enriched_at IS NULL`, use `enrichment_status IN (...)` (6.9) |
| **markFailed() semantics muddled** | Separated `low_confidence_reason` vs `last_error`; `needs_manual_review=false` for transient errors |
| **buildClearPayload() NOT NULL violation** | Added `CLEAR_DEFAULTS` constant with `[]` for array fields (6.0) |
| **Pass 0 failure reason wrong for <HARD_MIN** | Distinct messages: "critically short (<200)" vs "short with no anchors" |
| **N+1 query in writeEnrichment()** | Pass `scotusCase` from run selection; no re-query for vote_split/dissent_authors |
| **Quote truncation breaks verbatim** | Flag `evidence_quotes_truncated` instead of silently truncating |
| **case_type from GPT** | Added `deriveCaseType()` function (6.12) - computed, not asked |
| **Status transitions undefined** | Added authoritative state machine diagram (6.13) |
| **evidence_anchors DB type undefined** | Documented as `TEXT[]` nullable, `CLEAR_DEFAULTS` uses `[]` |
| **support_anchor/deriveAnchorType undefined** | DELETED - not used, removes dead reference |

### Round 5 Fixes (Still Applied)

| Issue | Fix |
|-------|-----|
| **Pass 0 return shape fragile** | Always returns `{ passed: boolean, ... }` - no implicit truthiness |
| **Field constants not defined** | Added `FACT_FIELDS`, `EDITORIAL_FIELDS`, `buildClearPayload()` in 6.0 |
| **flagAndSkip/writeEnrichment clearing rules** | Both now use `buildClearPayload()` for consistent field clearing |
| **Medium confidence behavior undefined** | Option A: Store Pass 2 outputs, keep non-public (6.5) |
| **Manual review approval path undefined** | Added `approveCase()` and `rejectAndRequeue()` functions (6.6) |
| **Consensus check implementation** | Cleaner `consensusMerge()` function with null normalization (7.1) |

### Round 3-4 Fixes (Still Applied)

| Issue | Fix |
|-------|-----|
| **Migration backfill bug** | Add column WITHOUT default, backfill, THEN set default (Phase 5) |
| **Stale editorial fields on flag/fail** | Use `buildClearPayload()` in `flagAndSkip()` and `markFailed()` |
| **`enriched_at` semantics** | Clear on flag/fail - means "last successful publishable enrichment" |
| **Pass 0 anchor logic** | Lenient mode documented with decision table (Phase 1) |
| **Self-consistency check** | Run Pass 1 twice, mismatch → force `low` (Phase 7.1) |
| **DB field precedence** | `vote_split` from DB wins; `dissent_exists` computed from `dissent_authors[]` (6.8) |
| **Confidence cap** | Cap at `medium` if `contains_anchor_terms=false` (7.2) |

### Round 1-2 Fixes (Still Applied)

| Fix | Location |
|-----|----------|
| Use `fact_extraction_confidence` everywhere | All code |
| Pass 0 return shape: `{ passed: boolean, ... }` | Phase 1 |
| `flagAndSkip()` / `writeEnrichment()` defined | Phase 6.2/6.4 |
| `enrichment_status` lifecycle | Phase 6.1 |
| Dropped loose anchor pattern | Phase 1 |
| Disposition lock validation | `validateNoDrift()` |
| Require anchor quote for HIGH | `validatePass1()` |

### Known Gaps (Acceptable for MVP)

| Gap | Status |
|-----|--------|
| Drift validation scope | Only checks `summary_spicy` vs `practical_effect` |
| No admin UI | Manual SQL for review (6.6 has functions) |
| No claim-to-quote linkage | "Some quotes exist" is sufficient |
| Cost tracking hardcoded | Can derive from `response.usage` later |
| Shadow docket detection | Manual or pattern-based (see 6.12 future enhancement) |

---

## Concurrency Control

**Strategy:** Rely on GitHub Actions workflow-level concurrency (no DB-level locking for MVP).

```yaml
# In .github/workflows/scotus-enrichment.yml
concurrency:
  group: scotus-enrichment
  cancel-in-progress: false  # Don't cancel in-progress runs
```

This prevents parallel runs. If scale increases, add a `processing` status with atomic claim:
```sql
-- Future: atomic claim for parallel runners
UPDATE scotus_cases
SET enrichment_status = 'processing'
WHERE id = (
  SELECT id FROM scotus_cases
  WHERE enrichment_status IN ('pending', 'failed')
  ORDER BY decided_at DESC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

---

## Manual Review SOP

**Requeue a flagged case after fixing source data:**
```sql
UPDATE scotus_cases
SET enrichment_status = 'pending',
    needs_manual_review = false,
    fact_extraction_confidence = NULL,
    low_confidence_reason = NULL
WHERE id = <case_id>;
```

**Override and publish a medium-confidence case after human review:**
```sql
UPDATE scotus_cases
SET is_public = true,
    needs_manual_review = false
WHERE id = <case_id>;
```

---

## Files to Create/Modify

| File | Change |
|------|--------|
| `scripts/enrichment/scotus-fact-extraction.js` | NEW - Pass 0 + Pass 1 logic + validator |
| `scripts/enrichment/scotus-drift-validation.js` | NEW - Pass 2 drift checker |
| `scripts/enrichment/scotus-gpt-prompt.js` | Modify to accept Pass 1 facts |
| `scripts/scotus/enrich-scotus.js` | Two-pass flow with corrected gating |
| `migrations/XXX_scotus_two_pass.sql` | Schema additions |

---

## Cost Analysis

| Approach | Cost/Case | 100 Cases | Notes |
|----------|-----------|-----------|-------|
| Current (single-pass) | $0.0004 | $0.04 | But produces errors |
| Two-pass | $0.0008 | $0.08 | Accurate |

Two-pass cost is negligible. Accuracy is worth 2x.

---

## Test Plan

1. Clear existing enrichment from 3 test cases
2. Run two-pass enrichment
3. Verify factual accuracy:
   - FDA v. Alliance → Should say "standing dismissal" (procedural)
   - Starbucks v. McKinney → Should say "harder for NLRB"
   - Connelly → Should say "estate tax valuation"
4. If all 3 pass, bulk enrich remaining cases

---

## Future Enhancement: ADO-275

After MVP, ADO-275 will add:
- Frame bucket architecture (deterministic variation selection)
- Mismatch fuse (GPT can override frame if wrong)
- Style pattern system (replaces current variation pools)

This is an enhancement, not a blocker for MVP.

---

## References

- Existing prompt: `scripts/enrichment/scotus-gpt-prompt.js`
- Existing pools: `scripts/enrichment/scotus-variation-pools.js`
- Schema: `migrations/066_scotus_cases.sql`
- Similar script: `scripts/enrichment/enrich-executive-orders.js`
