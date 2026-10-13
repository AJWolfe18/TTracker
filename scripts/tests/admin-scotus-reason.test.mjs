/**
 * ADO-495: the SCOTUS admin list shows WHY a case is flagged or still a draft.
 *
 * Runs the real getReasonBadges() helper extracted from public/admin.html (it
 * lives in a text/babel script, so it cannot be imported; it sits between the
 * `scotusReasonBadges:start` / `:end` marker comments), and checks that the
 * admin-scotus list fetch returns every field the Reason column reads.
 *
 * Run: node scripts/tests/admin-scotus-reason.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const adminHtml = readFileSync(`${repoRoot}public/admin.html`, 'utf8');
const listFn = readFileSync(`${repoRoot}supabase/functions/admin-scotus/index.ts`, 'utf8');

const qaStatusesSrc = adminHtml.match(/const SCOTUS_QA_STATUSES = (\[[\s\S]*?\]);/);
const helperSrc = adminHtml.match(/\/\/ scotusReasonBadges:start([\s\S]*?)\/\/ scotusReasonBadges:end/);
assert.ok(qaStatusesSrc, 'SCOTUS_QA_STATUSES not found in admin.html');
assert.ok(helperSrc, 'scotusReasonBadges:start/end markers not found in admin.html');

const getReasonBadges = new Function(
  `const SCOTUS_QA_STATUSES = ${qaStatusesSrc[1]};\n${helperSrc[1]}\nreturn getReasonBadges;`,
)();

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const labels = (r) => r.badges.map((b) => b.label);
const NONE = { badges: [], title: '' };

test('admin-scotus list returns every field the Reason column reads', () => {
  const select = listFn.match(/const SELECT_FIELDS = `([\s\S]*?)`/);
  assert.ok(select, 'SELECT_FIELDS not found');
  const fields = new Set(select[1].split(',').map((f) => f.trim()));
  for (const f of ['clamp_reason', 'qa_status', 'is_public',
    'low_confidence_reason', 'manual_review_note', 'qa_review_note']) {
    assert.ok(fields.has(f), `SELECT_FIELDS is missing ${f}`);
  }
});

test('a draft never QA\'d shows its legacy clamp_reason, muted (values from migration 072)', () => {
  for (const [clamp, label] of [['cert_no_merits', 'cert no merits'], ['procedural_no_merits', 'procedural no merits'],
    ['missing_text', 'missing text'], ['drift_clamp', 'drift clamp'], ['facts_failed', 'facts failed']]) {
    const r = getReasonBadges({ clamp_reason: clamp, enrichment_status: 'pending', qa_status: null, is_public: false });
    assert.deepEqual(labels(r), [label]);
    assert.equal(r.badges[0].class, 'badge-closed');
  }
});

test('a stale clamp_reason never shows once the case has a QA status', () => {
  const r = getReasonBadges({ clamp_reason: 'cert_no_merits', enrichment_status: 'enriched', qa_status: 'pending_qa', is_public: false });
  assert.deepEqual(labels(r), ['Pending QA']);
  const approved = getReasonBadges({ clamp_reason: 'procedural_no_merits', enrichment_status: 'enriched', qa_status: 'approved', is_public: false });
  assert.deepEqual(approved, NONE);
});

test('blocking QA statuses show on any draft; only flagged/rejected use the alarm color', () => {
  const pending = getReasonBadges({ enrichment_status: 'enriched', qa_status: 'pending_qa', is_public: false });
  assert.deepEqual(labels(pending), ['Pending QA']);
  assert.equal(pending.badges[0].class, 'badge-closed');

  // Not just enriched drafts: a flagged/failed enrichment with a QA verdict shows it too.
  for (const enrichment_status of ['enriched', 'flagged', 'failed']) {
    for (const [qa, label] of [['flagged', 'Flagged'], ['rejected', 'Rejected']]) {
      const r = getReasonBadges({ enrichment_status, qa_status: qa, is_public: false });
      assert.deepEqual(labels(r), [label], `${enrichment_status}/${qa}`);
      assert.equal(r.badges[0].class, 'badge-failed', `${enrichment_status}/${qa}`);
    }
  }
});

test('approved and human_override are not reasons', () => {
  for (const qa of ['approved', 'human_override']) {
    assert.deepEqual(getReasonBadges({ enrichment_status: 'enriched', qa_status: qa, is_public: false }), NONE, qa);
  }
});

test('hover text carries the full low-confidence, manual review and QA notes', () => {
  const r = getReasonBadges({
    enrichment_status: 'enriched', qa_status: 'pending_qa', is_public: false,
    low_confidence_reason: 'No published vote count',
    manual_review_note: 'Check the dissent list',
    qa_review_note: 'Holding overstated',
  });
  assert.equal(r.title, 'Low confidence: No published vote count\nManual review: Check the dissent list\nQA: Holding overstated');
});

test('a draft with only a note still gets a badge to hover', () => {
  const lc = getReasonBadges({ enrichment_status: 'pending', is_public: false, low_confidence_reason: 'Too short' });
  assert.deepEqual(labels(lc), ['Low confidence']);
  assert.equal(lc.title, 'Low confidence: Too short');

  const note = getReasonBadges({ enrichment_status: 'enriched', qa_status: 'approved', is_public: false, manual_review_note: 'Verify vote' });
  assert.deepEqual(labels(note), ['Note']);
});

test('published rows always show nothing, whatever reasons or notes they carry', () => {
  assert.deepEqual(getReasonBadges({
    clamp_reason: 'cert_no_merits', enrichment_status: 'enriched', qa_status: 'flagged', is_public: true,
    low_confidence_reason: 'No published vote count', manual_review_note: 'Verify vote',
  }), NONE);
});

test('a clean draft shows nothing', () => {
  assert.deepEqual(getReasonBadges({ enrichment_status: 'pending', qa_status: null, is_public: false }), NONE);
});

let passed = 0, failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    process.stdout.write(`  ✓ ${name}\n`);
    passed++;
  } catch (err) {
    process.stderr.write(`  ✗ ${name}\n    ${err.message}\n`);
    failed++;
  }
}

process.stdout.write(`\nadmin-scotus-reason: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
