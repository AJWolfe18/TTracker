# SCOTUS Auto-Publish Implementation Plan (v3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision history:**
- v1 (2026-05-04): Initial draft.
- v2 (2026-05-04): Codex review fixes — atomic publish predicate, fail-closed confidence, fixed idempotency, mandatory PROD dry-run, explicit `--target` flag, schema preflight, skip dedupe, AC descoping, deterministic ordering, env validation, runner integration tests.
- v3 (2026-05-04): Codex round 2 fixes — `last_error` strict null-only everywhere (eliminates dry-run/live mismatch); booleans require strict `=== false` (true fail-closed); fake supabase records every `.eq/.is/.in` call to assert atomic predicate; mkdir ordering fix; Windows-safe CLI entrypoint via `fileURLToPath`; zero-candidate TEST branch; backup-based restore; `loadRecentSkipKeys` uses injected logger.

**Goal:** Automate the final publish step of the SCOTUS pipeline so newly-enriched cases reach trumpytracker.com without manual intervention, while still flagging anything risky for human review. **Fail-closed: any uncertainty holds.**

**Architecture:** Daily auto-publish script runs after the Claude Cloud Agent finishes enrichment. For each `enriched` case that's still hidden (`is_public=false`, `qa_status='pending_qa'`), evaluate four deterministic hold conditions plus a confidence floor. If all gates green, atomically set `qa_status='approved'` + `is_public=true` (gate predicates re-checked on UPDATE to prevent race). If any fail, leave the case in `pending_qa` and write a `pipeline_skips` row (with 24h dedupe). Bolts onto `scotus-tracker.yml` workflow as Phase 3.

**Tech Stack:** Node.js script using `@supabase/supabase-js`, existing `pipeline_skips` observability infra, GitHub Actions workflow step.

**ADO ticket:** [ADO-492](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/492) — currently Todo.

---

## Pre-Execution: Update ADO-492 AC

**MUST happen before Task 1** so the close in Task 9 doesn't violate the "AC verification before state change" hard gate.

- [ ] **Step 1:** Edit ADO-492 acceptance criteria to formally descope the admin "Published today: N" metric.

```
/ado 492 set acceptance-criteria "<ul>
<li>New SCOTUS cases that pass the gate reach the public site automatically — no manual admin action required</li>
<li>Cases meeting any hold condition do NOT auto-publish; they remain drafts with the reason recorded in pipeline_skips and visible on admin Failures tab</li>
<li>5 currently-stuck clean cases (1820, 1855, 1860, 1865, 1866) are auto-published on first PROD run after deployment</li>
<li>Castro v. Guevara (1859) is held back due to needs_manual_review=true</li>
<li>No new AI cost ($0)</li>
<li>Verified on TEST before PROD; mandatory read-only PROD dry-run before merge to confirm only the expected candidate set</li>
<li>Out of scope (deferred to follow-up ticket): admin dashboard 'Published today: N' metric. This is a UI add — auto-publish is functional without it.</li>
</ul>"
```

- [ ] **Step 2:** Add a comment on ADO-492 noting the descope and link to plan doc.

```
/ado 492 add comment "Acceptance criteria revised — admin 'Published today' metric formally descoped to follow-up ticket. See docs/superpowers/plans/2026-05-04-scotus-auto-publish.md."
```

---

## Hold Conditions (canonical reference — fail-closed)

A case is HELD (do NOT auto-publish) if ANY are true:

| Condition | Strict check (evaluator) | UPDATE filter (atomic) | Skip reason |
|---|---|---|---|
| Manual review flagged or unknown | `needs_manual_review !== false` | `.eq('needs_manual_review', false)` | `needs_manual_review` |
| Drift detected or unknown | `drift_detected !== false` | `.eq('drift_detected', false)` | `drift_detected` |
| Enrichment errored (any non-null) | `last_error !== null && last_error !== undefined` | `.is('last_error', null)` | `last_error` |
| Unknown / unrecognized confidence value | `fact_extraction_confidence` not in `{low, medium, high}` | `.in('fact_extraction_confidence', allowed)` | `unknown_confidence` |
| Confidence below floor | rank < `minConfidence` rank | `.in('fact_extraction_confidence', allowed)` | `low_confidence` |

**Symmetry guarantee:** Evaluator and UPDATE filter agree on every gate. Empty-string `last_error` HOLDS in evaluator (matches the strict `IS NULL` UPDATE filter). Booleans require exact `false` so null/undefined values can't slip through to publish.

Otherwise: AUTO-APPROVE — set `qa_status='approved'`, `is_public=true`, `qa_review_note='auto-approved by pipeline (gates passed) <iso>'`, `qa_reviewed_at=NOW()`.

---

## Open Decisions

1. **Confidence threshold default = `medium`** (allows medium + high, holds `low` and unknown). PROD distribution sample: ~93% high, ~5% medium, ~2% low. Override via `SCOTUS_AUTO_PUBLISH_MIN_CONFIDENCE` env var. Validated at startup — invalid value fails fast with exit 2.

2. **`last_error` is strict null-only** everywhere. Empty string, whitespace, or any non-null value HOLDS. This eliminates the v2 bug where the evaluator allowed empty string to publish but the atomic UPDATE filter (`.is('last_error', null)`) rejected it, causing false `race_skipped` counts.

3. **Boolean gates require `=== false`.** Schema is supposed to be NOT NULL DEFAULT false; preflight in Task 5 verifies that. Even so, the evaluator and UPDATE filter both fail closed on null/undefined/true.

4. **Skip dedupe = 24h** per (entity_id, reason). One pre-loaded query at run start; no per-row round trip.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/lib/skip-reasons.js` (modify) | Add `SCOTUS_AUTO_PUBLISH` pipeline + 5 new reasons (incl. `UNKNOWN_CONFIDENCE`) |
| `scripts/scotus/auto-publish.js` (create) | Gate evaluator + script with explicit `--target=test\|prod`, `--dry-run`, atomic publish, 24h skip dedupe, Windows-safe CLI guard |
| `scripts/tests/scotus-auto-publish.test.mjs` (create) | Unit tests for gate + integration tests for runner with fake Supabase that records every filter call |
| `.github/workflows/scotus-tracker.yml` (modify) | Add Phase 3 step after Fetch |
| `package.json` (modify) | Wire test into `qa:smoke` |

---

## Task 1: Extend skip-reasons.js with SCOTUS auto-publish constants

**Files:**
- Modify: `scripts/lib/skip-reasons.js:24-42`

- [ ] **Step 1: Add new pipeline + 5 reasons**

```javascript
export const PIPELINES = Object.freeze({
  RSS_FETCH:           'rss_fetch',
  RSS_ENRICHMENT:      'rss_enrichment',
  EMBEDDINGS:          'embeddings',
  ENTITY_EXTRACTION:   'entity_extraction',
  ENTITY_AGGREGATION:  'entity_aggregation',
  STORY_ENRICHMENT:    'story_enrichment',
  SCOTUS_AUTO_PUBLISH: 'scotus_auto_publish', // ADO-492 — held by gate
});

export const REASONS = Object.freeze({
  BUDGET_EXCEEDED:       'budget_exceeded',
  FRESHNESS_FILTER:      'freshness_filter',
  NO_ARTICLES:           'no_articles',
  NO_ENTITIES:           'no_entities',
  EMBEDDING_FAILURE:     'embedding_failure',
  MAX_RETRIES_EXCEEDED:  'max_retries_exceeded',
  PARSE_ERROR:           'parse_error',
  API_ERROR:             'api_error',
  // ADO-492 SCOTUS auto-publish gate holds
  NEEDS_MANUAL_REVIEW:   'needs_manual_review',
  DRIFT_DETECTED:        'drift_detected',
  LAST_ERROR:            'last_error',
  LOW_CONFIDENCE:        'low_confidence',
  UNKNOWN_CONFIDENCE:    'unknown_confidence',
});
```

- [ ] **Step 2: Commit**

```bash
git add scripts/lib/skip-reasons.js
git commit -m "feat(ADO-492): add SCOTUS_AUTO_PUBLISH pipeline + 5 hold reasons"
```

---

## Task 2: Gate evaluator + env validation (TDD, fail-closed)

**Files:**
- Create: `scripts/scotus/auto-publish.js`
- Create: `scripts/tests/scotus-auto-publish.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `scripts/tests/scotus-auto-publish.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateGate,
  validateMinConfidence,
  MIN_CONFIDENCE_DEFAULT,
  CONFIDENCE_VALUES,
} from '../scotus/auto-publish.js';
import { REASONS } from '../lib/skip-reasons.js';

const baseClean = { needs_manual_review: false, drift_detected: false, last_error: null, fact_extraction_confidence: 'high' };

test('evaluateGate: all green case publishes', () => {
  assert.deepEqual(evaluateGate(baseClean), { publish: true });
});

test('evaluateGate: medium confidence publishes (default threshold = medium)', () => {
  assert.deepEqual(evaluateGate({ ...baseClean, fact_extraction_confidence: 'medium' }), { publish: true });
});

test('evaluateGate: low confidence holds', () => {
  assert.deepEqual(evaluateGate({ ...baseClean, fact_extraction_confidence: 'low' }), { publish: false, reason: REASONS.LOW_CONFIDENCE });
});

test('evaluateGate: needs_manual_review === true holds', () => {
  assert.deepEqual(evaluateGate({ ...baseClean, needs_manual_review: true }), { publish: false, reason: REASONS.NEEDS_MANUAL_REVIEW });
});

test('evaluateGate: needs_manual_review null holds (fail-closed)', () => {
  assert.deepEqual(evaluateGate({ ...baseClean, needs_manual_review: null }), { publish: false, reason: REASONS.NEEDS_MANUAL_REVIEW });
});

test('evaluateGate: needs_manual_review undefined holds (fail-closed)', () => {
  assert.deepEqual(evaluateGate({ ...baseClean, needs_manual_review: undefined }), { publish: false, reason: REASONS.NEEDS_MANUAL_REVIEW });
});

test('evaluateGate: drift_detected === true holds', () => {
  assert.deepEqual(evaluateGate({ ...baseClean, drift_detected: true }), { publish: false, reason: REASONS.DRIFT_DETECTED });
});

test('evaluateGate: drift_detected null holds (fail-closed)', () => {
  assert.deepEqual(evaluateGate({ ...baseClean, drift_detected: null }), { publish: false, reason: REASONS.DRIFT_DETECTED });
});

test('evaluateGate: last_error non-empty string holds', () => {
  assert.deepEqual(evaluateGate({ ...baseClean, last_error: 'rate limit' }), { publish: false, reason: REASONS.LAST_ERROR });
});

test('evaluateGate: last_error empty string HOLDS (strict null-only, matches UPDATE filter)', () => {
  assert.deepEqual(evaluateGate({ ...baseClean, last_error: '' }), { publish: false, reason: REASONS.LAST_ERROR });
});

test('evaluateGate: last_error whitespace HOLDS (strict null-only)', () => {
  assert.deepEqual(evaluateGate({ ...baseClean, last_error: '   ' }), { publish: false, reason: REASONS.LAST_ERROR });
});

test('evaluateGate: last_error undefined treated as null (publishes)', () => {
  assert.deepEqual(evaluateGate({ ...baseClean, last_error: undefined }), { publish: true });
});

test('evaluateGate: precedence — needs_manual_review beats other holds', () => {
  const c = { needs_manual_review: true, drift_detected: true, last_error: 'x', fact_extraction_confidence: 'low' };
  assert.deepEqual(evaluateGate(c), { publish: false, reason: REASONS.NEEDS_MANUAL_REVIEW });
});

test('evaluateGate: stricter threshold "high" holds medium', () => {
  assert.deepEqual(evaluateGate({ ...baseClean, fact_extraction_confidence: 'medium' }, { minConfidence: 'high' }),
    { publish: false, reason: REASONS.LOW_CONFIDENCE });
});

test('evaluateGate: null confidence holds with UNKNOWN_CONFIDENCE', () => {
  assert.deepEqual(evaluateGate({ ...baseClean, fact_extraction_confidence: null }),
    { publish: false, reason: REASONS.UNKNOWN_CONFIDENCE });
});

test('evaluateGate: undefined confidence holds with UNKNOWN_CONFIDENCE', () => {
  assert.deepEqual(evaluateGate({ ...baseClean, fact_extraction_confidence: undefined }),
    { publish: false, reason: REASONS.UNKNOWN_CONFIDENCE });
});

test('evaluateGate: empty-string confidence holds with UNKNOWN_CONFIDENCE', () => {
  assert.deepEqual(evaluateGate({ ...baseClean, fact_extraction_confidence: '' }),
    { publish: false, reason: REASONS.UNKNOWN_CONFIDENCE });
});

test('evaluateGate: case-mismatched "HIGH" holds with UNKNOWN_CONFIDENCE (no auto-lowercase)', () => {
  assert.deepEqual(evaluateGate({ ...baseClean, fact_extraction_confidence: 'HIGH' }),
    { publish: false, reason: REASONS.UNKNOWN_CONFIDENCE });
});

test('evaluateGate: "unknown" string holds with UNKNOWN_CONFIDENCE', () => {
  assert.deepEqual(evaluateGate({ ...baseClean, fact_extraction_confidence: 'unknown' }),
    { publish: false, reason: REASONS.UNKNOWN_CONFIDENCE });
});

test('CONFIDENCE_VALUES exposes the canonical set', () => {
  assert.deepEqual([...CONFIDENCE_VALUES].sort(), ['high', 'low', 'medium']);
});

test('MIN_CONFIDENCE_DEFAULT is "medium"', () => {
  assert.equal(MIN_CONFIDENCE_DEFAULT, 'medium');
});

test('validateMinConfidence: accepts known values', () => {
  assert.equal(validateMinConfidence('high'), 'high');
  assert.equal(validateMinConfidence('medium'), 'medium');
  assert.equal(validateMinConfidence('low'), 'low');
});

test('validateMinConfidence: rejects unknown', () => {
  assert.throws(() => validateMinConfidence('HIGH'), /SCOTUS_AUTO_PUBLISH_MIN_CONFIDENCE/);
  assert.throws(() => validateMinConfidence('best'), /SCOTUS_AUTO_PUBLISH_MIN_CONFIDENCE/);
  assert.throws(() => validateMinConfidence(''), /SCOTUS_AUTO_PUBLISH_MIN_CONFIDENCE/);
});
```

- [ ] **Step 2: Run tests; expect all FAIL (module not found)**

```bash
node --test scripts/tests/scotus-auto-publish.test.mjs
```

- [ ] **Step 3: Write the gate evaluator**

Create `scripts/scotus/auto-publish.js`:

```javascript
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { PIPELINES, REASONS, recordSkip } from '../lib/skip-reasons.js';

export const CONFIDENCE_VALUES = Object.freeze(new Set(['low', 'medium', 'high']));
const CONFIDENCE_RANK = Object.freeze({ low: 0, medium: 1, high: 2 });
export const MIN_CONFIDENCE_DEFAULT = 'medium';

/**
 * Validate a min-confidence value at startup. Throws on unknown to fail fast.
 */
export function validateMinConfidence(v) {
  if (!CONFIDENCE_VALUES.has(v)) {
    throw new Error(`SCOTUS_AUTO_PUBLISH_MIN_CONFIDENCE invalid: ${JSON.stringify(v)}. Allowed: low|medium|high.`);
  }
  return v;
}

/**
 * Pure function: evaluate gate against a case row. Fail-closed throughout.
 *
 * Booleans require strict `=== false` — null/undefined/true all hold.
 * last_error is strict null-only (matches the atomic UPDATE filter `.is('last_error', null)`).
 *   - undefined → treated as null (publishes)
 *   - null → publishes
 *   - "" or whitespace or any string → holds
 * Confidence must be a canonical value (low|medium|high); unknown holds with UNKNOWN_CONFIDENCE.
 */
export function evaluateGate(c, opts = {}) {
  const minConfidence = opts.minConfidence || MIN_CONFIDENCE_DEFAULT;

  if (c.needs_manual_review !== false) return { publish: false, reason: REASONS.NEEDS_MANUAL_REVIEW };
  if (c.drift_detected !== false)      return { publish: false, reason: REASONS.DRIFT_DETECTED };

  // last_error: strict null-only. undefined treated as null (no error). Anything else holds.
  if (c.last_error !== null && c.last_error !== undefined) {
    return { publish: false, reason: REASONS.LAST_ERROR };
  }

  const conf = c.fact_extraction_confidence;
  if (!CONFIDENCE_VALUES.has(conf)) {
    return { publish: false, reason: REASONS.UNKNOWN_CONFIDENCE };
  }
  if (CONFIDENCE_RANK[conf] < CONFIDENCE_RANK[minConfidence]) {
    return { publish: false, reason: REASONS.LOW_CONFIDENCE };
  }

  return { publish: true };
}
```

- [ ] **Step 4: Run tests; expect all 23 PASS**

```bash
node --test scripts/tests/scotus-auto-publish.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add scripts/scotus/auto-publish.js scripts/tests/scotus-auto-publish.test.mjs
git commit -m "feat(ADO-492): fail-closed gate evaluator + env validation with TDD"
```

---

## Task 3: Runner with explicit `--target`, atomic publish, 24h skip dedupe

**Files:**
- Modify: `scripts/scotus/auto-publish.js`
- Modify: `scripts/tests/scotus-auto-publish.test.mjs`

The runner queries candidates, evaluates each, atomically publishes (re-checking ALL gate predicates in the UPDATE filter to prevent races), records held cases to `pipeline_skips` (with 24h dedupe), and exposes counters: `would_publish`, `published`, `held`, `race_skipped`, `skip_dedupe_suppressed`.

The fake supabase used in integration tests **records every `.eq()`, `.is()`, and `.in()` call on the UPDATE chain** so a regression that drops a gate predicate fails the test immediately.

- [ ] **Step 1: Append failing integration tests with a recording fake supabase**

Append to `scripts/tests/scotus-auto-publish.test.mjs`:

```javascript
import { runAutoPublish } from '../scotus/auto-publish.js';

/**
 * Fake supabase client. Records every filter call on the UPDATE chain so tests can
 * assert the atomic predicate is intact (codex round 2 finding 3).
 */
function makeFakeSupabase({ candidates = [], existingSkips = [], conflicts = new Set() } = {}) {
  const inserts = [];
  const updates = [];
  const updateFilterCalls = []; // array of arrays — one inner array per UPDATE call

  function from(table) {
    if (table === 'scotus_cases') return makeScotusChain();
    if (table === 'pipeline_skips') return makeSkipsChain();
    throw new Error(`fake: unknown table ${table}`);
  }

  function makeScotusChain() {
    let _isUpdate = false;
    let _payload = null;
    let _filterId = null;
    let _selectFields = null;
    const filterCalls = [];

    const chain = {
      select(fields) {
        _selectFields = fields;
        if (_isUpdate) {
          // UPDATE...select(): execute and resolve
          updateFilterCalls.push([...filterCalls]);
          const matched = !conflicts.has(_filterId);
          if (matched) updates.push({ id: _filterId, payload: _payload, filters: [...filterCalls] });
          return Promise.resolve({ data: matched ? [{ id: _filterId }] : [], error: null });
        }
        return chain; // SELECT path stays awaitable via .then below
      },
      update(payload) { _isUpdate = true; _payload = payload; return chain; },
      eq(field, value) {
        if (_isUpdate) filterCalls.push(['eq', field, value]);
        if (field === 'id') _filterId = value;
        return chain;
      },
      is(field, value) {
        if (_isUpdate) filterCalls.push(['is', field, value]);
        return chain;
      },
      in(field, values) {
        if (_isUpdate) filterCalls.push(['in', field, values]);
        return chain;
      },
      order() { return chain; },
      then(resolve) { resolve({ data: candidates, error: null }); }, // SELECT terminal
    };
    return chain;
  }

  function makeSkipsChain() {
    const chain = {
      insert(row) { inserts.push(row); return Promise.resolve({ error: null }); },
      select(_fields, _opts) {
        return {
          eq() { return this; },
          gte() { return this; },
          then(resolve) { resolve({ data: existingSkips, count: existingSkips.length, error: null }); },
        };
      },
      delete() {
        return { eq() { return this; }, then(resolve) { resolve({ data: null, error: null }); } };
      },
    };
    return chain;
  }

  return { from, _state: { inserts, updates, updateFilterCalls } };
}

function makeLog() {
  const lines = [];
  return {
    info: (m) => lines.push(['info', m]),
    warn: (m) => lines.push(['warn', m]),
    error: (m) => lines.push(['error', m]),
    lines,
  };
}

test('runAutoPublish: dry-run writes nothing and counts would_publish/held', async () => {
  const fake = makeFakeSupabase({
    candidates: [
      { id: 1, case_name: 'A', needs_manual_review: false, drift_detected: false, last_error: null, fact_extraction_confidence: 'high' },
      { id: 2, case_name: 'B', needs_manual_review: true,  drift_detected: false, last_error: null, fact_extraction_confidence: 'high' },
    ],
  });
  const summary = await runAutoPublish({ supabase: fake, dryRun: true, minConfidence: 'medium', log: makeLog() });
  assert.equal(summary.candidates, 2);
  assert.equal(summary.would_publish, 1);
  assert.equal(summary.published, 0);
  assert.equal(summary.held.needs_manual_review, 1);
  assert.equal(fake._state.inserts.length, 0);
  assert.equal(fake._state.updates.length, 0);
});

test('runAutoPublish: live writes publish 1 and skip 1', async () => {
  const fake = makeFakeSupabase({
    candidates: [
      { id: 1, case_name: 'A', needs_manual_review: false, drift_detected: false, last_error: null, fact_extraction_confidence: 'high' },
      { id: 2, case_name: 'B', needs_manual_review: false, drift_detected: false, last_error: null, fact_extraction_confidence: 'low' },
    ],
  });
  const summary = await runAutoPublish({ supabase: fake, dryRun: false, minConfidence: 'medium', log: makeLog() });
  assert.equal(summary.published, 1);
  assert.equal(summary.held.low_confidence, 1);
  assert.equal(fake._state.updates.length, 1);
  assert.equal(fake._state.updates[0].id, 1);
  assert.equal(fake._state.updates[0].payload.qa_status, 'approved');
  assert.equal(fake._state.updates[0].payload.is_public, true);
  assert.equal(fake._state.inserts.length, 1);
  assert.equal(fake._state.inserts[0].pipeline, 'scotus_auto_publish');
  assert.equal(fake._state.inserts[0].reason, 'low_confidence');
});

test('runAutoPublish: UPDATE includes ALL atomic gate predicates (regression guard)', async () => {
  const fake = makeFakeSupabase({
    candidates: [
      { id: 42, case_name: 'X', needs_manual_review: false, drift_detected: false, last_error: null, fact_extraction_confidence: 'high' },
    ],
  });
  await runAutoPublish({ supabase: fake, dryRun: false, minConfidence: 'medium', log: makeLog() });

  assert.equal(fake._state.updateFilterCalls.length, 1, 'exactly one UPDATE was issued');
  const calls = fake._state.updateFilterCalls[0];

  // Every required predicate MUST be present. Fail loudly if any is missing.
  const required = [
    ['eq', 'id', 42],
    ['eq', 'enrichment_status', 'enriched'],
    ['eq', 'is_public', false],
    ['eq', 'qa_status', 'pending_qa'],
    ['eq', 'needs_manual_review', false],
    ['eq', 'drift_detected', false],
    ['is', 'last_error', null],
  ];
  for (const [op, field, value] of required) {
    const found = calls.some((c) => c[0] === op && c[1] === field && JSON.stringify(c[2]) === JSON.stringify(value));
    assert.ok(found, `missing UPDATE filter: ${op}('${field}', ${JSON.stringify(value)})`);
  }
  // Confidence must be IN-filtered with the allowed set for minConfidence=medium → ['medium','high']
  const conf = calls.find((c) => c[0] === 'in' && c[1] === 'fact_extraction_confidence');
  assert.ok(conf, 'missing UPDATE filter: in("fact_extraction_confidence", ...)');
  assert.deepEqual([...conf[2]].sort(), ['high', 'medium']);
});

test('runAutoPublish: race-skipped (UPDATE matches 0 rows) increments race_skipped', async () => {
  const fake = makeFakeSupabase({
    candidates: [
      { id: 1, case_name: 'A', needs_manual_review: false, drift_detected: false, last_error: null, fact_extraction_confidence: 'high' },
    ],
    conflicts: new Set([1]),
  });
  const summary = await runAutoPublish({ supabase: fake, dryRun: false, minConfidence: 'medium', log: makeLog() });
  assert.equal(summary.published, 0);
  assert.equal(summary.race_skipped, 1);
});

test('runAutoPublish: 24h skip dedupe suppresses duplicate skip insert', async () => {
  const recentISO = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const fake = makeFakeSupabase({
    candidates: [
      { id: 9, case_name: 'C', needs_manual_review: true, drift_detected: false, last_error: null, fact_extraction_confidence: 'high' },
    ],
    existingSkips: [{ entity_id: '9', reason: 'needs_manual_review', created_at: recentISO }],
  });
  const summary = await runAutoPublish({ supabase: fake, dryRun: false, minConfidence: 'medium', log: makeLog() });
  assert.equal(summary.held.needs_manual_review, 1);
  assert.equal(summary.skip_dedupe_suppressed, 1);
  assert.equal(fake._state.inserts.length, 0);
});
```

Run them — expect all 5 fail (`runAutoPublish` not defined yet):

```bash
node --test scripts/tests/scotus-auto-publish.test.mjs
```

- [ ] **Step 2: Append the runner with atomic publish + 24h dedupe + counters + Windows-safe CLI**

Append to `scripts/scotus/auto-publish.js`:

```javascript
/**
 * Find candidate cases for auto-publish. Deterministic order by id ASC.
 */
export async function findCandidates(supabase) {
  const { data, error } = await supabase
    .from('scotus_cases')
    .select('id, case_name, needs_manual_review, drift_detected, last_error, fact_extraction_confidence, qa_status, is_public, prompt_version, enrichment_status')
    .eq('enrichment_status', 'enriched')
    .eq('is_public', false)
    .eq('qa_status', 'pending_qa')
    .order('id', { ascending: true });
  if (error) throw new Error(`findCandidates failed: ${error.message}`);
  return data || [];
}

/**
 * Allowed confidence values at or above minConfidence. Used to constrain UPDATE filter atomically.
 */
function allowedConfidencesAtLeast(minConfidence) {
  const minRank = CONFIDENCE_RANK[minConfidence];
  return ['low', 'medium', 'high'].filter((v) => CONFIDENCE_RANK[v] >= minRank);
}

/**
 * Atomic publish — UPDATE filter re-checks ALL gate predicates so a flag flip
 * between SELECT and UPDATE blocks the write. Returns true iff exactly one row updated.
 */
async function publishCase(supabase, caseId, minConfidence) {
  const note = `auto-approved by pipeline (gates passed) ${new Date().toISOString()}`;
  const { data, error } = await supabase
    .from('scotus_cases')
    .update({
      qa_status: 'approved',
      is_public: true,
      qa_review_note: note,
      qa_reviewed_at: new Date().toISOString(),
    })
    .eq('id', caseId)
    .eq('enrichment_status', 'enriched')
    .eq('is_public', false)
    .eq('qa_status', 'pending_qa')
    .eq('needs_manual_review', false)
    .eq('drift_detected', false)
    .is('last_error', null)
    .in('fact_extraction_confidence', allowedConfidencesAtLeast(minConfidence))
    .select('id');
  if (error) throw new Error(`publishCase ${caseId} failed: ${error.message}`);
  return (data || []).length === 1;
}

/**
 * Pre-fetch recent (last 24h) pipeline_skips for SCOTUS_AUTO_PUBLISH so we can dedupe inline.
 * Uses injected log (codex round 2 finding 8).
 */
async function loadRecentSkipKeys(supabase, log) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('pipeline_skips')
    .select('entity_id,reason,created_at')
    .eq('pipeline', PIPELINES.SCOTUS_AUTO_PUBLISH)
    .gte('created_at', cutoff);
  if (error) {
    log.warn(`[scotus-auto-publish] loadRecentSkipKeys failed (continuing without dedupe): ${error.message}`);
    return new Set();
  }
  return new Set((data || []).map((r) => `${r.entity_id}|${r.reason}`));
}

export async function runAutoPublish({ supabase, dryRun = false, minConfidence = MIN_CONFIDENCE_DEFAULT, log = console }) {
  validateMinConfidence(minConfidence);
  const candidates = await findCandidates(supabase);
  log.info(`[scotus-auto-publish] candidates: ${candidates.length} (target=${dryRun ? 'dry-run' : 'live'}, minConfidence=${minConfidence})`);

  const recentSkipKeys = dryRun ? new Set() : await loadRecentSkipKeys(supabase, log);

  let would_publish = 0;
  let published = 0;
  let race_skipped = 0;
  let skip_dedupe_suppressed = 0;
  const held = { needs_manual_review: 0, drift_detected: 0, last_error: 0, low_confidence: 0, unknown_confidence: 0 };

  for (const c of candidates) {
    const verdict = evaluateGate(c, { minConfidence });
    if (verdict.publish) {
      would_publish += 1;
      if (dryRun) {
        log.info(`[scotus-auto-publish] DRY-RUN would publish id=${c.id} (${c.case_name})`);
      } else {
        const ok = await publishCase(supabase, c.id, minConfidence);
        if (ok) {
          published += 1;
          log.info(`[scotus-auto-publish] published id=${c.id} (${c.case_name})`);
        } else {
          race_skipped += 1;
          log.warn(`[scotus-auto-publish] race-skipped id=${c.id} (${c.case_name}) — gate predicates no longer hold`);
        }
      }
    } else {
      held[verdict.reason] = (held[verdict.reason] || 0) + 1;
      const skipKey = `${c.id}|${verdict.reason}`;
      const isDup = recentSkipKeys.has(skipKey);
      const metadata = {
        needs_manual_review: c.needs_manual_review,
        drift_detected: c.drift_detected,
        last_error: c.last_error,
        fact_extraction_confidence: c.fact_extraction_confidence,
        prompt_version: c.prompt_version,
        dry_run: dryRun,
      };
      if (dryRun) {
        log.info(`[scotus-auto-publish] DRY-RUN would hold id=${c.id} reason=${verdict.reason}`);
      } else if (isDup) {
        skip_dedupe_suppressed += 1;
        log.info(`[scotus-auto-publish] held id=${c.id} reason=${verdict.reason} (skip dedupe — recent row exists)`);
      } else {
        await recordSkip(supabase, {
          pipeline: PIPELINES.SCOTUS_AUTO_PUBLISH,
          reason: verdict.reason,
          entity_type: 'scotus_case',
          entity_id: c.id,
          metadata,
        });
        log.info(`[scotus-auto-publish] held id=${c.id} reason=${verdict.reason}`);
      }
    }
  }

  const summary = { candidates: candidates.length, would_publish, published, race_skipped, held, skip_dedupe_suppressed, dryRun };
  log.info(`[scotus-auto-publish] summary ${JSON.stringify(summary)}`);
  return summary;
}

// CLI entry point — Windows-safe via fileURLToPath (codex round 2 finding 5).
const isMainModule = (() => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMainModule) {
  const args = process.argv.slice(2);
  const target = (args.find((a) => a.startsWith('--target=')) || '').split('=')[1];
  const dryRun = args.includes('--dry-run');

  if (!target || !['test', 'prod'].includes(target)) {
    console.error('Usage: node scripts/scotus/auto-publish.js --target=test|prod [--dry-run]');
    process.exit(2);
  }

  const TEST_REF = 'wnrjrywpcadwutfykflu';
  const PROD_REF = 'osjbulmltfpcoldydexg';

  let url, key;
  if (target === 'prod') {
    url = process.env.SUPABASE_URL;
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) { console.error('--target=prod requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }
    if (url.includes(TEST_REF)) { console.error(`REFUSING: SUPABASE_URL points at TEST project (${TEST_REF}) but --target=prod`); process.exit(2); }
  } else {
    url = process.env.SUPABASE_TEST_URL;
    key = process.env.SUPABASE_TEST_SERVICE_KEY;
    if (!url || !key) { console.error('--target=test requires SUPABASE_TEST_URL + SUPABASE_TEST_SERVICE_KEY'); process.exit(2); }
    if (url.includes(PROD_REF)) { console.error(`REFUSING: SUPABASE_TEST_URL points at PROD project (${PROD_REF}) but --target=test`); process.exit(2); }
  }

  let minConfidence;
  try { minConfidence = validateMinConfidence(process.env.SCOTUS_AUTO_PUBLISH_MIN_CONFIDENCE || MIN_CONFIDENCE_DEFAULT); }
  catch (e) { console.error(e.message); process.exit(2); }

  const supabase = createClient(url, key);

  runAutoPublish({ supabase, dryRun, minConfidence })
    .then(() => process.exit(0))
    .catch((err) => { console.error('[scotus-auto-publish] FATAL', err); process.exit(1); });
}
```

- [ ] **Step 3: Run all tests; expect 28 PASS** (23 gate + 5 runner integration including atomic-predicate guard)

```bash
node --test scripts/tests/scotus-auto-publish.test.mjs
```

- [ ] **Step 4: Commit**

```bash
git add scripts/scotus/auto-publish.js scripts/tests/scotus-auto-publish.test.mjs
git commit -m "feat(ADO-492): atomic publish + skip dedupe + Windows-safe CLI + integration tests"
```

---

## Task 4: Wire test into qa:smoke

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Find current qa entries**

```bash
grep -n 'qa:smoke\|qa:silent-skips' package.json
```

- [ ] **Step 2: Add new test script + chain it**

In `package.json` `scripts` block:

```json
"qa:scotus-auto-publish": "node --test scripts/tests/scotus-auto-publish.test.mjs",
```

Append `&& npm run qa:scotus-auto-publish` to the existing `qa:smoke` chain.

- [ ] **Step 3: Run qa:smoke**

```bash
npm run qa:smoke
```

Expected: all suites pass including the new 28 tests.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat(ADO-492): wire scotus-auto-publish tests into qa:smoke"
```

---

## Task 5: TEST verification — schema preflight, dry-run, live, idempotency

This task proves correctness end-to-end on TEST before touching PROD.

- [ ] **Step 1: Schema preflight (column constraints + insert path)**

Verify the `scotus_cases` boolean columns are NOT NULL and the `pipeline_skips` table accepts our pipeline + each reason. The boolean check defends the "fail-closed" assumption; the insert check defends `recordSkip` (codex round 2 finding 2 + previous round finding 5).

```bash
mkdir -p logs
node -e "
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_SERVICE_KEY);
(async () => {
  // Column-constraint preflight: confirm needs_manual_review + drift_detected default to false and are NOT NULL.
  const { data: cols, error: colErr } = await s.rpc('information_schema_columns_query', {});
  // Fallback: just sample 50 rows and verify no NULLs in the boolean columns.
  const { data: sample, error: sampErr } = await s
    .from('scotus_cases')
    .select('id,needs_manual_review,drift_detected')
    .limit(200);
  if (sampErr) { console.error('FAIL sample fetch:', sampErr.message); process.exit(1); }
  const nullsMR = sample.filter(r => r.needs_manual_review === null).length;
  const nullsDD = sample.filter(r => r.drift_detected === null).length;
  console.log('null needs_manual_review in 200-row sample:', nullsMR);
  console.log('null drift_detected in 200-row sample:',     nullsDD);
  if (nullsMR > 0 || nullsDD > 0) {
    console.warn('WARN: nullable boolean columns detected — fail-closed evaluator is essential. Continuing.');
  }

  // Insert preflight for pipeline_skips
  const reasons = ['needs_manual_review','drift_detected','last_error','low_confidence','unknown_confidence'];
  for (const r of reasons) {
    const { error } = await s.from('pipeline_skips').insert({
      pipeline: 'scotus_auto_publish', reason: r, entity_type: 'preflight', entity_id: 'preflight-' + r,
      metadata: { preflight: true }
    });
    console.log(r, error ? 'FAIL: '+error.message : 'ok');
  }
  const { error: delErr } = await s.from('pipeline_skips').delete().eq('entity_type', 'preflight');
  console.log('cleanup', delErr ? 'FAIL: '+delErr.message : 'ok');
})();
"
```

Expected: 5 reasons inserted ok, cleanup ok. Investigate any FAIL before proceeding.

- [ ] **Step 2: Snapshot current TEST candidates** (mkdir BEFORE write — codex round 2 finding 4)

```bash
mkdir -p logs
node -e "
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_SERVICE_KEY);
s.from('scotus_cases')
 .select('id,case_name,needs_manual_review,drift_detected,last_error,fact_extraction_confidence,is_public,qa_status,enrichment_status')
 .eq('enrichment_status','enriched').eq('is_public',false).eq('qa_status','pending_qa').order('id')
 .then(r => require('fs').writeFileSync('logs/scotus-auto-publish-pre.json', JSON.stringify(r.data, null, 2)));
"
cat logs/scotus-auto-publish-pre.json | head -40
```

Note: count of rows = `N`. Note the IDs.

- [ ] **Step 3: Ensure at least one candidate exists AND at least one would HOLD** (codex round 2 finding 6)

Three branches based on `N` from Step 2:

**Branch A: `N == 0` candidates on TEST**

We need to seed one. Pick the most recent enriched-but-public case and temporarily reset it. Find one:

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_SERVICE_KEY);
s.from('scotus_cases')
 .select('id,case_name,is_public,qa_status,needs_manual_review,drift_detected,last_error,fact_extraction_confidence')
 .eq('enrichment_status','enriched').eq('is_public',true).order('id',{ascending:false}).limit(1)
 .then(r => { console.log(JSON.stringify(r.data?.[0], null, 2)); });
"
```

Backup the row (we will restore exact values in Step 7):

```bash
# Replace <K> with the id printed above
node -e "
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_SERVICE_KEY);
s.from('scotus_cases').select('id,is_public,qa_status,needs_manual_review,drift_detected,last_error,fact_extraction_confidence,qa_review_note,qa_reviewed_at').eq('id', <K>)
 .then(r => require('fs').writeFileSync('logs/test-row-backup.json', JSON.stringify(r.data?.[0], null, 2)));
"
```

Reset it into a candidate state:

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_SERVICE_KEY);
s.from('scotus_cases').update({ is_public: false, qa_status: 'pending_qa', qa_review_note: null, qa_reviewed_at: null }).eq('id', <K>).select().then(r => console.log(r));
"
```

Then continue with the held-row seed instructions in Branch B using a SECOND candidate id (or pick another row to flip `needs_manual_review` on).

**Branch B: `N >= 1` candidates but none would HOLD** (snapshot shows all gates green)

Pick candidate `K` from snapshot, back up its full row, then flip `needs_manual_review` to true:

```bash
# Replace <K> with a candidate id from Step 2 snapshot
node -e "
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_SERVICE_KEY);
s.from('scotus_cases').select('id,needs_manual_review,drift_detected,last_error,fact_extraction_confidence').eq('id', <K>)
 .then(r => require('fs').writeFileSync('logs/test-row-backup.json', JSON.stringify(r.data?.[0], null, 2)));
"
node -e "
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_SERVICE_KEY);
s.from('scotus_cases').update({ needs_manual_review: true }).eq('id', <K>).select().then(r => console.log(r));
"
```

**Branch C: `N >= 1` and at least one already holds** — proceed to Step 4 (no seeding needed). Set `K = null` and skip restore in Step 7.

- [ ] **Step 4: Dry-run on TEST**

```bash
node scripts/scotus/auto-publish.js --target=test --dry-run
```

Expected: per-case decisions printed. Final summary: `would_publish` reflects expected count, `held.<reason>` >= 1. Record `would_publish_dry`.

- [ ] **Step 5: Live run on TEST**

```bash
node scripts/scotus/auto-publish.js --target=test
```

Expected: `summary.published === would_publish_dry`. At least one `pipeline_skips` row inserted matching the held case.

- [ ] **Step 6: Idempotency check — second run**

```bash
node scripts/scotus/auto-publish.js --target=test
```

Expected behavior:
- `summary.published === 0` (already-published rows fall out of candidate filter)
- `summary.held.<reason>` >= 1 — held rows still match candidate filter and get re-evaluated
- `summary.skip_dedupe_suppressed >= 1` — re-skips suppressed by 24h dedupe
- No new `pipeline_skips` rows inserted

Verify total skip rows didn't grow:

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_SERVICE_KEY);
s.from('pipeline_skips').select('*', { count: 'exact', head: true }).eq('pipeline','scotus_auto_publish')
 .then(r => console.log('total skip rows:', r.count));
"
```

- [ ] **Step 7: Restore TEST data using exact backup values** (codex round 2 finding 7)

If you seeded a row (Branch A or B), restore from `logs/test-row-backup.json`:

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const s = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_SERVICE_KEY);
const backup = JSON.parse(fs.readFileSync('logs/test-row-backup.json', 'utf-8'));
const { id, ...originalFields } = backup;
s.from('scotus_cases').update(originalFields).eq('id', id).select().then(r => console.log('restored', r));
// Cleanup any auto-publish skip rows for this id
s.from('pipeline_skips').delete().eq('pipeline','scotus_auto_publish').eq('entity_id', String(id)).then(r => console.log('cleanup', r));
"
```

If Branch A also published the seeded row (because we reset it to a publishable state), the live run's UPDATE to `is_public=true, qa_status='approved'` will be overridden by the restore — that's correct.

---

## Task 6: Wire script into scotus-tracker.yml workflow

**Files:**
- Modify: `.github/workflows/scotus-tracker.yml`

- [ ] **Step 1: Verify secret naming pattern**

```bash
grep -n 'secrets\.SUPABASE' .github/workflows/scotus-tracker.yml
```

Expected: `secrets.SUPABASE_SERVICE_KEY`. CLAUDE.md notes the secret NAME is `SUPABASE_SERVICE_KEY` while scripts read `SUPABASE_SERVICE_ROLE_KEY`. Match the existing pattern.

- [ ] **Step 2: Insert Phase 3 after Fetch step (line ~63), before log-upload**

```yaml
      # --------------------------
      # Phase 3: Auto-publish (ADO-492)
      # --------------------------
      - name: Auto-publish enriched SCOTUS cases
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          SCOTUS_AUTO_PUBLISH_MIN_CONFIDENCE: medium
        run: |
          set -euo pipefail
          mkdir -p logs
          node scripts/scotus/auto-publish.js --target=prod 2>&1 | tee logs/auto-publish.log
```

`mkdir -p logs` is defensive (the existing "Create logs dir" step already creates it; explicit mkdir survives reordering). `--target=prod` is required; the script's URL-ref check will refuse to run if `SUPABASE_URL` resolves to a TEST project.

- [ ] **Step 3: Commit + push to test**

```bash
git add .github/workflows/scotus-tracker.yml
git commit -m "feat(ADO-492): add auto-publish phase to scotus-tracker.yml"
git push origin test
```

The `if: github.ref == 'refs/heads/main'` gate means this push doesn't run the workflow.

---

## Task 7: PROD read-only dry-run + PR

**Mandatory pre-merge dry-run.** Enumerate the PROD candidate set before opening the PR. If anything unexpected, STOP.

- [ ] **Step 1: Snapshot PROD candidates (read-only)**

**Option A: Supabase PROD MCP** (if connected this session)

```
mcp__supabase-prod__execute_sql with:
SELECT id, case_name, needs_manual_review, drift_detected, last_error, fact_extraction_confidence
FROM scotus_cases
WHERE enrichment_status='enriched' AND is_public=false AND qa_status='pending_qa'
ORDER BY id;
```

**Option B: Local script run with PROD env vars** (export, run, unset)

```bash
mkdir -p logs
export PROD_URL=<paste from password manager>
export PROD_KEY=<paste from password manager>
SUPABASE_URL=$PROD_URL SUPABASE_SERVICE_ROLE_KEY=$PROD_KEY \
  node scripts/scotus/auto-publish.js --target=prod --dry-run | tee logs/prod-dry-run.log
unset PROD_URL PROD_KEY
```

- [ ] **Step 2: Verify candidate set matches expectations**

Expected:
- 6 candidates total: 1820, 1855, 1860, 1865, 1866, 1859
- 5 evaluate to publish: 1820, 1855, 1860, 1865, 1866
- 1 evaluates to hold (`needs_manual_review`): 1859

Anything else: STOP. Do NOT proceed if any unexpected case would auto-publish.

- [ ] **Step 3: Create deployment branch from main**

```bash
git fetch origin
git checkout -b deploy/ado-492-scotus-auto-publish origin/main
```

- [ ] **Step 4: Cherry-pick all ADO-492 commits**

```bash
git log origin/main..origin/test --oneline | grep ADO-492
git cherry-pick <sha1> <sha2> <sha3> <sha4>
```

- [ ] **Step 5: Push and create PR**

````bash
git push -u origin deploy/ado-492-scotus-auto-publish
gh pr create --title "feat(ADO-492): SCOTUS auto-publish on QA pass" --body "$(cat <<'EOF'
## Summary
- Auto-publishes enriched SCOTUS cases when 4 deterministic gates pass + confidence >= medium
- Fail-closed throughout — booleans require strict `=== false`, last_error strict null-only, unknown confidence holds
- Atomic publish: all gate predicates re-checked in UPDATE filter, asserted by regression test
- 24h skip dedupe prevents Failures-tab pollution

## Tickets
- ADO-492 — SCOTUS pipeline: auto-publish enriched cases

## Test plan
- [x] 23 gate unit tests + 5 runner integration tests (incl. atomic-predicate regression guard) wired into qa:smoke
- [x] TEST schema preflight: pipeline_skips accepts new pipeline + 5 reasons; boolean column null check
- [x] TEST dry-run + live: published count matches dry-run would_publish
- [x] TEST idempotency: second run published=0, held re-evaluated, skip dedupe suppresses re-inserts
- [x] PROD read-only dry-run completed — exactly 6 candidates: 1820,1855,1860,1865,1866 publish; 1859 holds (needs_manual_review)
- [ ] First PROD scheduled run after merge: same 5 publish, 1859 holds, no unexpected cases touched

## Notes
- Workflow uses `--target=prod`; script refuses to run if SUPABASE_URL resolves to a TEST project (defense in depth)
- Confidence threshold = medium (configurable via SCOTUS_AUTO_PUBLISH_MIN_CONFIDENCE env var on the workflow)
- Windows-safe CLI guard via fileURLToPath for local runs
EOF
)"
````

- [ ] **Step 6: Wait for AI review, address findings, merge**

```bash
gh pr view <PR#>
gh pr merge <PR#> --squash --delete-branch
```

---

## Task 8: PROD verification

- [ ] **Step 1: After next 18:00 UTC run, fetch logs**

```bash
gh run list --workflow=scotus-tracker.yml --limit 5
gh run view <run-id> --log | grep '\[scotus-auto-publish\]'
```

Expected:
- `published id=1820 ...` × 5 (1820, 1855, 1860, 1865, 1866)
- `held id=1859 reason=needs_manual_review`
- `summary {"candidates":6,"would_publish":5,"published":5,...}`

If anything else publishes, treat it as an incident.

- [ ] **Step 2: Spot-check public site**

Open https://trumpytracker.com — 5 cases should appear in the SCOTUS section.

- [ ] **Step 3: Spot-check admin Failures tab**

Filter to `scotus_auto_publish`. Confirm 1859 with reason `needs_manual_review`.

- [ ] **Step 4 (optional): Manual re-run via dispatch**

```bash
gh workflow run "SCOTUS Tracker (PROD scheduled)" --ref main -f skip_fetch=true
```

---

## Task 9: AC verification + close ADO-492

- [ ] **Step 1: Re-fetch ticket AC and verify each bullet**

```
/ado 492 get details
```

| AC bullet | MET? | Evidence |
|---|---|---|
| Cases passing gate reach public site automatically | YES / NO | Task 8.1 logs |
| Hold conditions prevent auto-publish; reason in pipeline_skips + Failures tab | YES / NO | Task 8.3 |
| 5 stuck cases auto-published on first PROD run | YES / NO | Task 8.1 |
| Castro v. Guevara held due to needs_manual_review | YES / NO | Task 8.3 |
| No new AI cost ($0) | YES | Script uses no external APIs |
| Verified on TEST + PROD read-only dry-run before merge | YES | Task 5 + Task 7.1-2 |
| Admin "Published today" metric (descoped) | OUT OF SCOPE | Pre-Execution step |

If any item is NO: STOP, do not close.

- [ ] **Step 2: File follow-up ticket for admin metric**

```
/ado create story "SCOTUS admin: Published today metric" parent=467 description="Surface count of cases auto-published today on the admin SCOTUS dashboard. Deferred from ADO-492. Read scotus_cases where qa_review_note like 'auto-approved by pipeline%' AND qa_reviewed_at >= today."
```

- [ ] **Step 3: Move ADO-492 to Closed**

```
/ado 492 set state Closed
/ado 492 add comment "Auto-publish live on PROD as of <date>. PR #<num> merged. 5 stuck cases auto-published on first run; 1859 held correctly. Admin metric AC was formally descoped to ADO-<NEW> before close. All in-scope AC met."
```

- [ ] **Step 4: Handoff doc**

Create `docs/handoffs/<DATE>-ado-492-scotus-auto-publish.md` covering: fail-closed design (booleans + last_error), atomic predicate (regression guard test), 24h skip dedupe, --target gating, Windows-safe CLI, TEST verification including the seeded held row, PROD read-only dry-run results, PROD first-run results, env var for tightening confidence threshold.

- [ ] **Step 5: Run /end-work**

---

## Self-Review (v3)

**Codex round 2 fixes:**
1. ✅ `last_error` is strict null-only in BOTH evaluator and UPDATE filter — eliminates the v2 false race-skip on empty/whitespace strings.
2. ✅ Booleans require `=== false` everywhere; null/undefined/true all hold. Schema preflight in Task 5.1 also samples for null values to alert on schema drift. True fail-closed.
3. ✅ Fake supabase records every `.eq/.is/.in` call on the UPDATE chain. New regression test asserts the full required predicate set — refactor that drops a filter fails immediately.
4. ✅ Task 5 commands `mkdir -p logs` BEFORE the Node script that writes to `logs/`.
5. ✅ CLI entrypoint uses `fileURLToPath(import.meta.url) === process.argv[1]`, wrapped in try/catch — Windows-safe.
6. ✅ Task 5 Step 3 has explicit branches A/B/C for zero/no-held/has-held candidates on TEST.
7. ✅ Task 5 Step 7 restores using exact backup values from `logs/test-row-backup.json`, not hardcoded false.
8. ✅ `loadRecentSkipKeys` accepts `log` parameter and uses it for warnings — consistent with rest of runner.

**Codex round 1 fixes (unchanged from v2):**
- Atomic publish predicate; mandatory PROD dry-run; explicit `--target=test|prod` with URL-ref check; pipeline_skips schema preflight; `would_publish` counter; workflow `mkdir -p logs`; same secret naming pattern; AC formally descoped before close; deterministic ordering; `validateMinConfidence` fail-fast; runner integration tests; 24h skip dedupe.

**Architecture trade-offs:**
- Held rows still match candidate filter every run (intentional — flag flips during human review let them through next run); 24h skip dedupe handles noise.
- Confidence is enum (`low|medium|high`); unknown values fail closed.
- Race protection enforced atomically via UPDATE filter + asserted by integration test — no transaction or RPC needed for SCOTUS volume (~5 cases/day).
- `--target=prod` + URL ref check + Windows-safe CLI guard make the script safe to run locally on any platform without accidentally writing to the wrong environment.
