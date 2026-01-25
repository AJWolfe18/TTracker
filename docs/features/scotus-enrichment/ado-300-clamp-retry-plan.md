# ADO-300: SCOTUS Post-Processing Clamp Rules + Pass1 Retry Ladder

**ADO Card:** [#300](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/300)
**Status:** Planning Complete - Ready to Implement
**Related:** ADO-295 (Backfill System - deferred to PR2)

## Problem

- Drift protection blocks cert/procedural cases and mislabels merits cases as "Judicial Sidestepping" (~56% of cases)
- Re-run frequency is low; failures stall enrichment and skew label distribution
- Pipeline blocks instead of publishing safe output

## Solution: "Publish Don't Block"

1. **Clamp** cert/procedural cases to safe output and publish them
2. **Retry** Pass 1 with better models when extraction fails
3. **Forbid** Sidestepping when there's a clear merits winner
4. **Override** publishing for clamped cases (decouple from confidence)

---

## Implementation Order

1. Migration `072_scotus_clamp_fields.sql`
2. Add `clampAndLabel()` + `enforceEditorialConstraints()` to `scotus-fact-extraction.js`
3. Add `buildLabelConstraintsBlock()` to `scotus-gpt-prompt.js`
4. Wire up Pass 0 gate, retry ladder, integration in `enrich-scotus.js`
5. Test with `--dry-run`
6. Code review, commit, push

---

## 1. Migration: `migrations/072_scotus_clamp_fields.sql`

```sql
-- 072_scotus_clamp_fields.sql
-- ADO-300: SCOTUS clamp/retry/publish override fields

BEGIN;

ALTER TABLE IF EXISTS scotus_cases
  ADD COLUMN IF NOT EXISTS clamp_reason TEXT,
  ADD COLUMN IF NOT EXISTS publish_override BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS facts_model_used TEXT,
  ADD COLUMN IF NOT EXISTS retry_reason TEXT;

COMMENT ON COLUMN scotus_cases.clamp_reason IS
  'Clamp reason: missing_text, cert_no_merits, procedural_no_merits, drift_clamp, facts_failed, etc.';

COMMENT ON COLUMN scotus_cases.publish_override IS
  'When true, publish even if confidence < high (used for cert/procedural clamps only).';

COMMENT ON COLUMN scotus_cases.facts_model_used IS
  'Final model used for Pass 1 fact extraction after retries/fallbacks.';

COMMENT ON COLUMN scotus_cases.retry_reason IS
  'Why Pass 1 retried (e.g., missing_fields, stage_mismatch, missing_evidence).';

COMMIT;
```

---

## 2. Fact Extraction: `scripts/enrichment/scotus-fact-extraction.js`

Add these functions near the bottom, before the DB HELPERS section.

**IMPORTANT:** Use ES module syntax (`export function`), not CommonJS.

```javascript
// ============================================================================
// ADO-300: CLAMP AND LABEL POST-PROCESSING
// ============================================================================

/**
 * Build evidence text blob from quotes array
 */
function buildEvidenceText(evidenceQuotes) {
  if (!Array.isArray(evidenceQuotes)) return '';
  return evidenceQuotes.filter(Boolean).join(' | ');
}

/**
 * Detect if case looks like cert stage or procedural
 */
function looksCertOrProcedural(facts, evidenceText) {
  const typeRaw = (facts?.case_type || '').toLowerCase();
  const ev = (evidenceText || '').toLowerCase();

  const isCert =
    typeRaw === 'cert_stage' ||
    (ev.includes('certiorari') && (ev.includes('denied') || ev.includes('granted'))) ||
    (ev.includes('petition') && ev.includes('denied'));

  const isProcedural =
    typeRaw === 'procedural' ||
    facts?.merits_reached === false ||
    /(standing|moot|jurisdiction|improvidently granted|\bdig\b)/i.test(ev);

  return { isCert, isProcedural };
}

/**
 * Detect GVR-ish patterns (vacated & remanded for reconsideration)
 */
function detectGVRish(evidenceText) {
  const ev = (evidenceText || '').toLowerCase();
  return (
    /granted.{0,60}vacat.{0,60}remand/i.test(ev) ||
    /vacat.{0,40}remand.{0,80}(in light of|for further|for reconsideration)/i.test(ev) ||
    /remand.{0,80}(in light of|for further|for reconsideration)/i.test(ev)
  );
}

/**
 * Fallback label picker when model violates constraints
 */
function fallbackMeritsLabel(facts) {
  const disp = (facts?.disposition || '').toLowerCase();
  const prevailing = (facts?.prevailing_party || 'unknown').toLowerCase();

  if (prevailing === 'petitioner') return 'Crumbs from the Bench';
  if (prevailing === 'respondent') return 'Rubber-stamping Tyranny';

  // Coarse fallback from disposition only
  if (disp.includes('affirm')) return 'Rubber-stamping Tyranny';
  if (disp.includes('revers') || disp.includes('vacat')) return 'Crumbs from the Bench';
  return 'Institutional Sabotage';
}

/**
 * Post-processing: Clamp and route facts to publishable output
 * Runs AFTER Pass 1 facts extraction, BEFORE Pass 2 editorial
 *
 * Goals:
 * 1. Turn drift detection into "route + clamp + publish" (not block)
 * 2. Remove "Sidestepping" as the model's safety blanket
 * 3. Deterministic label assignment when rules are clear
 *
 * @param {Object} facts - Pass 1 output
 * @returns {Object} Clamped facts with label_policy for Pass 2
 */
export function clampAndLabel(facts) {
  const evidence_text = buildEvidenceText(facts?.evidence_quotes || []);
  const disp = (facts?.disposition || '').toLowerCase();

  const { isCert, isProcedural } = looksCertOrProcedural(facts, evidence_text);

  // Deterministic clamp for cert/procedural
  let clamp_reason = null;
  let publish_override = false;

  if (isCert) {
    clamp_reason = 'cert_no_merits';
    publish_override = true;
  } else if (isProcedural) {
    clamp_reason = 'procedural_no_merits';
    publish_override = true;
  }

  // Check for explicit precedent overrule
  const explicitOverrule = /\boverrule(d|s)?\b|\bwe overrule\b/i.test(evidence_text);

  // V&R subtype detection
  const isVR = disp.includes('vacat') || disp.includes('remand');
  const gvrish = isVR ? detectGVRish(evidence_text) : false;

  // Sidestepping forbidden when clear merits disposition + clear winner
  const meritsDisposition = /(affirm|revers)/i.test(disp) || (isVR && !gvrish);
  const prevailing = (facts?.prevailing_party || 'unknown').toLowerCase();
  const clearWinner = prevailing && prevailing !== 'unknown' && prevailing !== 'unclear';

  const sidesteppingForbidden = !!(meritsDisposition && clearWinner);

  // Build label policy for Pass 2
  const label_policy = {
    forbid: [],
    allow: []
  };

  if (clamp_reason) {
    // Clamped: force Sidestepping
    label_policy.allow = ['Judicial Sidestepping'];
  } else if (explicitOverrule) {
    // Explicit overrule: force Constitutional Crisis
    label_policy.allow = ['Constitutional Crisis'];
  } else {
    // Normal merits: forbid Sidestepping when clear winner
    if (sidesteppingForbidden) {
      label_policy.forbid.push('Judicial Sidestepping');
    }
    label_policy.allow = [
      'Crumbs from the Bench',
      'Institutional Sabotage',
      'Rubber-stamping Tyranny',
      'Constitutional Crisis',
      'Democracy Wins'
    ];
  }

  return {
    ...facts,
    _evidence_text: evidence_text, // ephemeral, not persisted
    clamp_reason,
    publish_override,
    _sidestepping_forbidden: sidesteppingForbidden,
    _is_vr: isVR,
    _is_gvr: gvrish,
    label_policy
  };
}

/**
 * Enforce clamp rules + label constraints after Pass 2
 * Called AFTER Pass 2 returns, as the "last mile" guardrail
 *
 * @param {Object} facts - Clamped facts from clampAndLabel()
 * @param {Object} editorial - Raw Pass 2 output
 * @param {Object} driftResult - Output from validateNoDrift()
 * @returns {Object} Constrained editorial output
 */
export function enforceEditorialConstraints(facts, editorial, driftResult = {}) {
  const out = { ...(editorial || {}) };
  const clamp_reason = facts?.clamp_reason || null;

  // Clamp behavior: force safe procedural output
  if (clamp_reason === 'cert_no_merits' || clamp_reason === 'procedural_no_merits') {
    out.who_wins = 'Procedural ruling - no merits decision';
    out.who_loses = 'Case resolved without a merits ruling';
    out.ruling_label = 'Judicial Sidestepping';
    out.ruling_impact_level = Math.min(out.ruling_impact_level ?? 2, 2);
    console.log(`   [CLAMP] Applied ${clamp_reason} → Sidestepping`);
    return out;
  }

  // If drift detected but not already clamped, check if it looks cert/procedural
  const isDrift = driftResult?.severity === 'hard';
  if (isDrift) {
    const evidence_text = facts?._evidence_text || buildEvidenceText(facts?.evidence_quotes || []);
    const { isCert, isProcedural } = looksCertOrProcedural(facts, evidence_text);
    if (isCert || isProcedural) {
      out.who_wins = 'Procedural ruling - no merits decision';
      out.who_loses = 'Case resolved without a merits ruling';
      out.ruling_label = 'Judicial Sidestepping';
      out.ruling_impact_level = Math.min(out.ruling_impact_level ?? 2, 2);
      console.log(`   [CLAMP] Drift + procedural → Sidestepping`);
      return out;
    }
  }

  // Enforce label policy constraints
  const label = out.ruling_label || '';
  const forbid = facts?.label_policy?.forbid || [];
  const allow = facts?.label_policy?.allow || [];

  const violatesForbid = forbid.includes(label);
  const violatesAllow = allow.length > 0 && !allow.includes(label);

  if (violatesForbid || violatesAllow) {
    const newLabel = fallbackMeritsLabel(facts);
    console.log(`   [CLAMP] Label violation: ${label} → ${newLabel}`);
    out.ruling_label = newLabel;
  }

  return out;
}
```

**Also add to DB_COLUMNS set:**
```javascript
// In DB_COLUMNS set, add:
'clamp_reason', 'publish_override', 'facts_model_used', 'retry_reason',
```

---

## 3. GPT Prompt: `scripts/enrichment/scotus-gpt-prompt.js`

Add this function and integrate into `buildPass2UserPrompt()`:

```javascript
/**
 * Build label constraints block for Pass 2 prompt
 * Tells GPT which labels are allowed/forbidden based on clamp rules
 */
export function buildLabelConstraintsBlock(facts) {
  const allow = facts?.label_policy?.allow || [];
  const forbid = facts?.label_policy?.forbid || [];
  const clamp_reason = facts?.clamp_reason || null;

  // If clamped, be very explicit
  if (clamp_reason) {
    return `
LABEL CONSTRAINT (MANDATORY):
This is a ${clamp_reason.replace(/_/g, ' ')} case.
- ruling_label MUST be "Judicial Sidestepping"
- who_wins MUST be "Procedural ruling - no merits decision"
- who_loses MUST be "Case resolved without a merits ruling"
- Do NOT claim a substantive winner or loser
`.trim();
  }

  // Normal case: provide allowed/forbidden lists
  let block = 'LABEL CONSTRAINTS:\n';

  if (allow.length > 0) {
    block += `- Allowed labels: ${allow.join(', ')}\n`;
  }
  if (forbid.length > 0) {
    block += `- FORBIDDEN labels (do NOT use): ${forbid.join(', ')}\n`;
  }

  if (forbid.includes('Judicial Sidestepping')) {
    block += `- This case has a clear merits disposition and prevailing party. "Judicial Sidestepping" is NOT appropriate.\n`;
  }

  return block.trim();
}
```

**Integrate into `buildPass2UserPrompt()`:**

Find the function and add the constraints block at the start:

```javascript
export function buildPass2UserPrompt(scotusCase, facts, variationInjection = '') {
  // ADD THIS: Build and inject label constraints
  const labelConstraints = buildLabelConstraintsBlock(facts);

  let constraints = labelConstraints ? `${labelConstraints}\n\n` : '';

  // ... rest of existing function (PROCEDURAL CASE CONSTRAINT, etc.)
```

---

## 4. Main Script: `scripts/scotus/enrich-scotus.js`

### 4a. Add config at top:

```javascript
// ADO-300: Retry ladder config
const SOURCE_MIN_CHARS = Number(process.env.SCOTUS_SOURCE_MIN_CHARS || 1000);
const FACTS_MODEL_FALLBACKS = (process.env.SCOTUS_FACTS_MODEL_FALLBACKS || 'gpt-4o-mini,gpt-4o')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
```

### 4b. Add imports:

```javascript
import {
  // ... existing imports ...
  clampAndLabel,
  enforceEditorialConstraints,
} from '../enrichment/scotus-fact-extraction.js';
```

### 4c. Pass 0 gate (in enrichCase function, after source quality check):

The existing `checkSourceQuality()` handles this. Update to set clamp_reason:

```javascript
if (!pass0.passed) {
  console.log(`   [PASS 0] Failed: ${pass0.low_confidence_reason}`);
  if (!args.dryRun) {
    // ADO-300: Set clamp_reason for missing_text
    await supabase
      .from('scotus_cases')
      .update({
        clamp_reason: 'missing_text',
        publish_override: false,
        is_public: false,
        enrichment_status: 'flagged',
        low_confidence_reason: pass0.low_confidence_reason,
      })
      .eq('id', scotusCase.id);
  }
  return { success: false, skipped: true, reason: pass0.low_confidence_reason };
}
```

### 4d. Pass 1 retry ladder:

Replace the single extractFactsWithConsensus call with retry logic:

```javascript
// ADO-300: Retry ladder for Pass 1
let facts = null;
let usedModel = 'gpt-4o-mini';
let retry_reason = null;

for (const model of FACTS_MODEL_FALLBACKS) {
  usedModel = model;
  console.log(`   📋 Pass 1: Trying ${model}...`);

  try {
    const { facts: extractedFacts, usage } = await extractFactsWithConsensus(
      openai,
      scotusCase,
      pass0Metadata,
      args.skipConsensus,
      model  // Pass model to extraction function
    );

    // Check for issues that warrant retry
    const issues = getFactsIssues(extractedFacts);
    if (issues.length === 0) {
      facts = extractedFacts;
      totalCost += calculateCost(usage);
      break;
    }

    retry_reason = issues.join(',');
    console.log(`   ⚠️ Issues with ${model}: ${retry_reason}`);
  } catch (err) {
    console.log(`   ⚠️ ${model} failed: ${err.message}`);
    retry_reason = `error:${err.message.slice(0, 50)}`;
  }
}

if (!facts) {
  // All models failed
  await supabase.from('scotus_cases').update({
    clamp_reason: 'facts_failed',
    publish_override: false,
    is_public: false,
    facts_model_used: usedModel,
    retry_reason,
    enrichment_status: 'failed',
  }).eq('id', scotusCase.id);
  return { success: false, error: retry_reason };
}
```

Add helper function:

```javascript
function getFactsIssues(facts) {
  const issues = [];
  if (!facts) return ['no_facts'];

  if (!facts.disposition) issues.push('missing_disposition');

  const eq = facts.evidence_quotes || [];
  if (!Array.isArray(eq) || eq.length === 0) issues.push('missing_evidence');

  const typeRaw = (facts.case_type || '').toLowerCase();
  const prevailing = (facts.prevailing_party || 'unknown').toLowerCase();

  // Stage mismatch: cert/procedural shouldn't have clear winner
  if ((typeRaw === 'cert_stage' || typeRaw === 'procedural') &&
      prevailing !== 'unknown' && prevailing !== 'unclear') {
    issues.push('stage_mismatch');
  }

  return issues;
}
```

### 4e. Apply clampAndLabel after Pass 1:

```javascript
// ADO-300: Apply clamp rules
facts.case_type = deriveCaseType(facts, scotusCase.case_name);
const clampedFacts = clampAndLabel(facts);

console.log(`   Clamp: ${clampedFacts.clamp_reason || 'none'} | Sidestepping forbidden: ${clampedFacts._sidestepping_forbidden}`);
```

### 4f. Apply enforceEditorialConstraints after Pass 2:

```javascript
// After drift check
const driftCheck = validateNoDrift(clampedFacts, editorial);

// ADO-300: Enforce constraints (may override editorial)
const constrainedEditorial = enforceEditorialConstraints(clampedFacts, editorial, driftCheck);

// ADO-300: Publishing rule
const isPublic = clampedFacts.fact_extraction_confidence === 'high' ||
                 clampedFacts.publish_override === true;
```

### 4g. Update writeEnrichment call:

```javascript
await writeEnrichment(scotusCase.id, scotusCase, {
  ...clampedFacts,
  ...constrainedEditorial,
  clamp_reason: clampedFacts.clamp_reason,
  publish_override: clampedFacts.publish_override,
  facts_model_used: usedModel,
  retry_reason: retry_reason,
  needs_manual_review: needsReview,
  is_public: isPublic
}, supabase);
```

---

## 5. Update writeEnrichment in scotus-fact-extraction.js

Add new fields to the payload:

```javascript
// In writeEnrichment function, add to payload:
clamp_reason: data.clamp_reason || null,
publish_override: data.publish_override || false,
facts_model_used: data.facts_model_used || null,
retry_reason: data.retry_reason || null,
```

---

## Out of Scope (Deferred to ADO-295)

- Backfill job system
- `backfill_status`, `backfill_attempts`, `backfill_last_error` fields
- Automatic retrieval of missing source text
- `missing_text` cases stay private, flagged for future backfill

---

## Acceptance Criteria

- [ ] Sidestepping share drops from ~56% to ~15-25%
- [ ] Drift cases publish via clamp (no more blocked cert/procedural)
- [ ] `missing_text` cases remain private and flagged
- [ ] `facts_model_used` and `retry_reason` present for all processed cases
- [ ] Label constraints appear in Pass 2 prompt
- [ ] Affirmed/reversed with clear winner never gets Sidestepping

---

## Testing

```bash
# Dry run a few cases
node scripts/scotus/enrich-scotus.js --limit=5 --dry-run

# Run on a small batch
node scripts/scotus/enrich-scotus.js --limit=10

# Check results
SELECT id, case_name, clamp_reason, publish_override, facts_model_used, retry_reason, ruling_label
FROM scotus_cases
WHERE enriched_at > NOW() - INTERVAL '1 hour'
ORDER BY enriched_at DESC;
```
