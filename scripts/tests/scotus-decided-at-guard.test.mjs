// ADO-493: the SCOTUS fetch skips clusters whose date_filed cannot be trusted.
import assert from 'node:assert/strict';
import { checkDecidedAt, DEFAULT_SINCE_DATE } from '../scotus/decided-at-guard.js';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const opts = { floor: DEFAULT_SINCE_DATE, now: NOW };

assert.equal(DEFAULT_SINCE_DATE, '2024-10-01', 'default = start of the October 2024 term');

// usable
assert.equal(checkDecidedAt('2024-10-01', opts), null, 'the floor itself is in range');
assert.equal(checkDecidedAt('2026-06-29', opts), null);
assert.equal(checkDecidedAt('2026-09-26', opts), null, 'one day of time-zone slack');

// the February 23, 2026 bulk import: real 2020 orders, outside the run's range
assert.match(checkDecidedAt('2020-01-13', opts), /before the run's since date 2024-10-01/);
// an explicit older --since is honoured
assert.equal(checkDecidedAt('2020-01-13', { floor: '2020-01-01', now: NOW }), null);

// missing, malformed, impossible, future
assert.equal(checkDecidedAt(null, opts), 'no date_filed');
assert.equal(checkDecidedAt('', opts), 'no date_filed');
assert.match(checkDecidedAt('2026-9-3', opts), /unparseable/);
assert.match(checkDecidedAt('not-a-date', opts), /unparseable/);
assert.match(checkDecidedAt('2025-02-30', opts), /impossible/);
assert.match(checkDecidedAt('2026-09-28', opts), /in the future/);

process.stdout.write('scotus-decided-at-guard: ok\n');
