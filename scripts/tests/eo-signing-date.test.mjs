/**
 * ADO-589: executive_orders.date must be the Federal Register SIGNING date.
 *
 * The tracker stored publication_date for 18 months, so every EO showed a
 * "Signed" date 1-3 days late (EO 14426: shown September 11, signed September 8).
 * These tests pin the mapping helpers the tracker and the backfill both use.
 *
 * Run: node scripts/tests/eo-signing-date.test.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickEoDate, isValidIsoDate, resolveBackfillDate } from '../lib/eo-dates.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.log(`  [FAIL] ${name}\n         ${err.message}`);
    failed++;
  }
}

const TODAY = '2026-09-21';

test('1. signing_date wins over publication_date (EO 14426 shape)', () => {
  assert.equal(
    pickEoDate({ signing_date: '2026-09-08', publication_date: '2026-09-11' }, TODAY),
    '2026-09-08',
  );
});

test('2. falls back to publication_date when the API has no signing_date', () => {
  assert.equal(pickEoDate({ signing_date: null, publication_date: '2026-09-11' }, TODAY), '2026-09-11');
  assert.equal(pickEoDate({ publication_date: '2026-09-11' }, TODAY), '2026-09-11');
});

test('3. falls back to today when neither date is present', () => {
  assert.equal(pickEoDate({}, TODAY), TODAY);
  assert.equal(pickEoDate(null, TODAY), TODAY);
});

test('4. a malformed signing_date is ignored, not stored', () => {
  assert.equal(pickEoDate({ signing_date: 'Sept 8, 2026', publication_date: '2026-09-11' }, TODAY), '2026-09-11');
  assert.equal(pickEoDate({ signing_date: '', publication_date: '2026-09-11' }, TODAY), '2026-09-11');
});

test('5. the tracker actually uses the helper for the date column (regression guard)', () => {
  const src = readFileSync(new URL('../executive-orders-tracker-supabase.js', import.meta.url), 'utf8');
  assert.match(src, /date:\s*pickEoDate\(item,\s*today\)/, 'tracker must map date via pickEoDate');
  // Anchored at line start so the legitimate `publication_date: item.publication_date` field does not match.
  assert.doesNotMatch(src, /^\s*date:\s*item\.publication_date/m, 'tracker must not store publication_date in date');
});

// Codex P1: a format-only check accepted 2026-09-31, which PostgreSQL rejects and
// which would fail the whole tracker insert batch.
test('6. isValidIsoDate rejects impossible calendar dates, accepts real ones', () => {
  assert.equal(isValidIsoDate('2026-09-31'), false, 'September has 30 days');
  assert.equal(isValidIsoDate('2026-02-29'), false, '2026 is not a leap year');
  assert.equal(isValidIsoDate('2026-13-01'), false, 'month 13');
  assert.equal(isValidIsoDate('2026-00-10'), false, 'month 0');
  assert.equal(isValidIsoDate('2026-9-8'), false, 'must be zero-padded');
  assert.equal(isValidIsoDate('09/08/2026'), false, 'US format');
  assert.equal(isValidIsoDate(20260908), false, 'not a string');
  assert.equal(isValidIsoDate('2028-02-29'), true, '2028 is a leap year');
  assert.equal(isValidIsoDate('2026-09-08'), true);
  assert.equal(isValidIsoDate('2026-12-31'), true);
});

test('7. pickEoDate skips an impossible signing_date and never returns it', () => {
  assert.equal(pickEoDate({ signing_date: '2026-09-31', publication_date: '2026-09-11' }, TODAY), '2026-09-11');
  assert.equal(pickEoDate({ signing_date: '2026-09-31', publication_date: '2026-11-31' }, TODAY), TODAY);
});

// Codex P1: the backfill must never fall back to publication_date. With
// signing_date "09/08/2026" and publication_date "2026-09-11" the old code would
// have replaced an already-correct September 8 with September 11.
test('8. resolveBackfillDate: invalid signing_date is reported, not replaced with a fallback', () => {
  assert.deepEqual(resolveBackfillDate('2026-09-08', '09/08/2026'), { action: 'invalid' });
  assert.deepEqual(resolveBackfillDate('2026-09-08', '2026-09-31'), { action: 'invalid' });
});

test('9. resolveBackfillDate: missing / noop / update', () => {
  assert.deepEqual(resolveBackfillDate('2026-09-11', null), { action: 'missing' });
  assert.deepEqual(resolveBackfillDate('2026-09-11', ''), { action: 'missing' });
  assert.deepEqual(resolveBackfillDate('2026-09-08', '2026-09-08'), { action: 'noop' });
  assert.deepEqual(resolveBackfillDate('2026-09-11', '2026-09-08'), { action: 'update', to: '2026-09-08' });
});

test('10. the backfill uses resolveBackfillDate, not the tracker fallback helper (regression guard)', () => {
  const src = readFileSync(new URL('../maintenance/backfill-eo-signing-dates.js', import.meta.url), 'utf8');
  assert.match(src, /resolveBackfillDate\(eo\.date,\s*fr\.signing_date\)/);
  assert.doesNotMatch(src, /pickEoDate\(/, 'backfill must not fall back to publication_date');
});

console.log(`\neo-signing-date: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
