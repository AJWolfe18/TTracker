/**
 * ADO-589: executive_orders.date must be the Federal Register SIGNING date.
 *
 * The tracker stored publication_date for 18 months, so every EO showed a
 * "Signed" date 1-3 days late (EO 14426: shown September 11, signed September 8).
 * These tests pin the mapping helper the tracker and the backfill both use.
 *
 * Run: node scripts/tests/eo-signing-date.test.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickEoDate } from '../lib/eo-dates.js';

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

console.log(`\neo-signing-date: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
