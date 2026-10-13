/**
 * ADO-495: the SCOTUS admin list shows WHY a case is flagged or still a draft.
 *
 * Runs the real getReasonBadges() helper extracted from public/admin.html (it
 * lives in a text/babel script, so it cannot be imported), and checks that the
 * admin-scotus list fetch returns every field the Reason column reads.
 *
 * Run: node scripts/tests/admin-scotus-reason.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const repoRoot = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:');
const adminHtml = readFileSync(`${repoRoot}public/admin.html`, 'utf8');
const listFn = readFileSync(`${repoRoot}supabase/functions/admin-scotus/index.ts`, 'utf8');

const qaStatusesSrc = adminHtml.match(/const SCOTUS_QA_STATUSES = (\[[\s\S]*?\]);/);
const helperSrc = adminHtml.match(/const getReasonBadges = (\(c\) => \{[\s\S]*?\n {12}\});/);
assert.ok(qaStatusesSrc, 'SCOTUS_QA_STATUSES not found in admin.html');
assert.ok(helperSrc, 'getReasonBadges not found in admin.html');

const getReasonBadges = new Function(
  `const SCOTUS_QA_STATUSES = ${qaStatusesSrc[1]}; return ${helperSrc[1]};`,
)();

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const labels = (r) => r.badges.map((b) => b.label);

test('admin-scotus list returns every field the Reason column reads', () => {
  const select = listFn.match(/const SELECT_FIELDS = `([\s\S]*?)`/);
  assert.ok(select, 'SELECT_FIELDS not found');
  const fields = new Set(select[1].split(',').map((f) => f.trim()));
  for (const f of ['clamp_reason', 'qa_status', 'enrichment_status', 'is_public',
    'low_confidence_reason', 'manual_review_note', 'qa_review_note']) {
    assert.ok(fields.has(f), `SELECT_FIELDS is missing ${f}`);
  }
});

test('a clamped draft shows its clamp_reason, muted', () => {
  const r = getReasonBadges({ clamp_reason: 'cert_denied', enrichment_status: 'flagged', is_public: false });
  assert.deepEqual(labels(r), ['cert denied']);
  assert.equal(r.badges[0].class, 'badge-closed');
});

test('an enriched draft shows its QA status; only flagged/rejected use the alarm color', () => {
  const pending = getReasonBadges({ enrichment_status: 'enriched', qa_status: 'pending_qa', is_public: false });
  assert.deepEqual(labels(pending), ['Pending QA']);
  assert.equal(pending.badges[0].class, 'badge-closed');

  for (const qa of ['flagged', 'rejected']) {
    const r = getReasonBadges({ enrichment_status: 'enriched', qa_status: qa, is_public: false });
    assert.equal(r.badges[0].class, 'badge-failed', qa);
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

test('a note with no clamp or QA status still gets a badge to hover', () => {
  const lc = getReasonBadges({ enrichment_status: 'pending', is_public: false, low_confidence_reason: 'Too short' });
  assert.deepEqual(labels(lc), ['Low confidence']);
  assert.equal(lc.title, 'Low confidence: Too short');

  const note = getReasonBadges({ enrichment_status: 'enriched', is_public: true, manual_review_note: 'Verify vote' });
  assert.deepEqual(labels(note), ['Note']);
});

test('published rows and clean drafts show no badge', () => {
  assert.deepEqual(getReasonBadges({ clamp_reason: 'cert_denied', enrichment_status: 'enriched', qa_status: 'approved', is_public: true }),
    { badges: [], title: '' });
  assert.deepEqual(getReasonBadges({ enrichment_status: 'pending', is_public: false }), { badges: [], title: '' });
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
