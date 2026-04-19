/**
 * ADO-480 §6.2: Unit tests for admin EO edge-function helpers.
 *
 * The edge functions live in supabase/functions/{admin-executive-orders,
 * admin-update-executive-orders}/index.ts (Deno TypeScript). We can't import
 * those directly from Node, so this test file re-implements the pure helpers
 * and asserts behavior. KEEP THESE IN SYNC if you change the edge functions.
 *
 * Run: node scripts/tests/admin-eo-unit.test.mjs
 */

import assert from 'node:assert/strict';

// ─── Helper mirrors (kept in sync with edge function source) ───────────────

// supabase/functions/_shared/eo-severity.ts
function deriveSeverityRating(alarmLevel) {
  if (alarmLevel == null) return null;
  if (alarmLevel >= 5) return 'critical';
  if (alarmLevel === 4) return 'high';
  if (alarmLevel === 3) return 'medium';
  if (alarmLevel === 2) return 'low';
  return null;
}

// admin-executive-orders / index.ts — sort key parser.
// Uses lastIndexOf('-') so underscored fields like enriched_at-desc parse correctly.
const SORT_COLUMNS = new Set(['date', 'alarm_level', 'enriched_at']);
const SORT_DIRS = new Set(['asc', 'desc']);
function parseSort(input) {
  if (typeof input !== 'string' || input.length === 0) return null;
  const sep = input.lastIndexOf('-');
  if (sep <= 0 || sep >= input.length - 1) return null;
  const col = input.substring(0, sep);
  const dir = input.substring(sep + 1);
  if (!SORT_COLUMNS.has(col) || !SORT_DIRS.has(dir)) return null;
  return { col, dir };
}

// admin-executive-orders / index.ts — cursor decode.
// Cursor schema: {col, val, id}. `col` MUST match the request's sort column
// or the cursor is rejected (catches stale URLs from when sort was different).
// Returns null (no cursor), 'invalid' (malformed), or {col, val, id: string}.
//
// `id` is opaque — PROD uses VARCHAR(50) legacy `eo_<ts>_<suffix>`, TEST uses
// INTEGER coerced to string. Pattern `[A-Za-z0-9_-]{1,50}` prevents PostgREST
// filter injection (`,`, `(`, `)`, `"`) when the id is interpolated into a
// keyset filter downstream. Legacy numeric-ID cursors are accepted for
// backward compatibility (coerced to string on decode).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALARM_RE = /^[0-5]$/;
// Full-string anchor mandatory — without `$` a payload that starts ISO-like but
// continues with `,and(id.gt.0` would pass validation and inject a second
// predicate clause into the PostgREST `.or()` string.
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
const EO_ID_RE = /^[A-Za-z0-9_-]{1,50}$/;
function validateCursorVal(col, val) {
  if (col === 'date') return DATE_RE.test(val);
  if (col === 'alarm_level') return ALARM_RE.test(val);
  if (col === 'enriched_at') return ISO_TS_RE.test(val);
  return false;
}
function decodeCursor(cursor, expectedCol) {
  if (!cursor) return null;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    if (typeof decoded !== 'object' || decoded === null) return 'invalid';
    const col = decoded.col;
    const val = decoded.val;
    const id = decoded.id;
    if (typeof col !== 'string' || col !== expectedCol) return 'invalid';
    if (typeof val !== 'string' || !validateCursorVal(col, val)) return 'invalid';
    const idStr = typeof id === 'number' && Number.isFinite(id) ? String(id) : id;
    if (typeof idStr !== 'string' || !EO_ID_RE.test(idStr)) return 'invalid';
    return { col, val, id: idStr };
  } catch {
    return 'invalid';
  }
}
function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

// admin-executive-orders / index.ts — tab predicate.
function matchesSubtab(eo, latestLogStatus, subtab) {
  switch (subtab) {
    case 'needs_review':
      return eo.prompt_version === 'v1' && !eo.is_public && eo.needs_manual_review;
    case 'unenriched':
      return eo.prompt_version !== 'v1';
    case 'unpublished':
      return eo.prompt_version === 'v1' && !eo.is_public;
    case 'published':
      return eo.is_public === true;
    case 'failed':
      return eo.prompt_version !== 'v1' && latestLogStatus === 'failed';
    case 'all':
    default:
      return true;
  }
}

// public/admin.html EditExecutiveOrderModal — sorted-stringify array compare.
function arraysEqualUnordered(a, b) {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

// ─── Test runner ───────────────────────────────────────────────────────────

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ─── Severity mapping (plan §6.1: "Severity helper mapping I3") ────────────

test('deriveSeverityRating maps alarm_level correctly', () => {
  assert.equal(deriveSeverityRating(null), null);
  assert.equal(deriveSeverityRating(undefined), null);
  assert.equal(deriveSeverityRating(0), null);
  assert.equal(deriveSeverityRating(1), null);
  assert.equal(deriveSeverityRating(2), 'low');
  assert.equal(deriveSeverityRating(3), 'medium');
  assert.equal(deriveSeverityRating(4), 'high');
  assert.equal(deriveSeverityRating(5), 'critical');
  // Out-of-range > 5 still floors to critical (defensive)
  assert.equal(deriveSeverityRating(6), 'critical');
});

// ─── Sort parser (plan §6.1: "Sort by underscored key") ────────────────────

test('parseSort accepts simple column-direction', () => {
  assert.deepEqual(parseSort('date-desc'), { col: 'date', dir: 'desc' });
  assert.deepEqual(parseSort('date-asc'), { col: 'date', dir: 'asc' });
});

test('parseSort handles underscored column via lastIndexOf', () => {
  // SCOTUS bug: split('-') would produce ['enriched_at', 'desc'] but join.
  // ours uses lastIndexOf('-') → splits at the LAST '-', preserving 'enriched_at'.
  assert.deepEqual(parseSort('enriched_at-desc'), { col: 'enriched_at', dir: 'desc' });
  assert.deepEqual(parseSort('alarm_level-asc'), { col: 'alarm_level', dir: 'asc' });
});

test('parseSort rejects invalid inputs', () => {
  assert.equal(parseSort(null), null);
  assert.equal(parseSort(''), null);
  assert.equal(parseSort('-desc'), null);  // empty col
  assert.equal(parseSort('date-'), null);  // empty dir
  assert.equal(parseSort('date-foo'), null);  // bad dir
  assert.equal(parseSort('not_a_col-desc'), null);  // not in whitelist
  assert.equal(parseSort('date'), null);  // no separator
  assert.equal(parseSort(123), null);
});

// ─── Cursor encode/decode (plan §6.1: "Cursor roundtrip", "Date cursor validator") ──

test('encodeCursor + decodeCursor roundtrip for date sort (string id — PROD format)', () => {
  // PROD IDs are legacy `eo_<timestamp>_<suffix>` VARCHAR(50).
  const payload = { col: 'date', val: '2024-01-15', id: 'eo_1775754706788_9yyufp4qa' };
  const encoded = encodeCursor(payload);
  assert.deepEqual(decodeCursor(encoded, 'date'), payload);
});

test('encodeCursor + decodeCursor roundtrip for alarm_level sort (underscored col)', () => {
  const payload = { col: 'alarm_level', val: '5', id: 'eo_1774458464771_xeklz674w' };
  const encoded = encodeCursor(payload);
  assert.deepEqual(decodeCursor(encoded, 'alarm_level'), payload);
});

test('encodeCursor + decodeCursor roundtrip for enriched_at sort', () => {
  const payload = { col: 'enriched_at', val: '2026-04-17T20:30:45Z', id: 'eo_1774976561506_kebv7taqw' };
  const encoded = encodeCursor(payload);
  assert.deepEqual(decodeCursor(encoded, 'enriched_at'), payload);
});

test('decodeCursor accepts legacy numeric-ID cursors (TEST backward-compat, coerces to string)', () => {
  // TEST used INTEGER IDs pre-ADO-481. Old browser sessions with cached URLs must still work.
  const payload = { col: 'date', val: '2024-01-15', id: 42 };
  const encoded = encodeCursor(payload);
  assert.deepEqual(decodeCursor(encoded, 'date'), { col: 'date', val: '2024-01-15', id: '42' });
});

test('decodeCursor rejects cursor whose col mismatches expected', () => {
  // Stale cursor from a previous sort must NOT silently page wrong data.
  const dateCursor = encodeCursor({ col: 'date', val: '2024-01-15', id: 'eo_abc123' });
  assert.equal(decodeCursor(dateCursor, 'alarm_level'), 'invalid');
});

test('decodeCursor returns null for empty cursor', () => {
  assert.equal(decodeCursor(null, 'date'), null);
  assert.equal(decodeCursor(undefined, 'date'), null);
  assert.equal(decodeCursor('', 'date'), null);
});

test('decodeCursor rejects malformed base64 / JSON', () => {
  assert.equal(decodeCursor('!!!not-base64!!!', 'date'), 'invalid');
  assert.equal(decodeCursor(Buffer.from('not json', 'utf8').toString('base64'), 'date'), 'invalid');
  assert.equal(decodeCursor(Buffer.from('"a string"', 'utf8').toString('base64'), 'date'), 'invalid');
});

test('decodeCursor rejects ISO timestamps for date field (SCOTUS inverse bug)', () => {
  // date col is a DATE column, not timestamptz — must reject ISO timestamps.
  const isoCursor = encodeCursor({ col: 'date', val: '2024-01-15T00:00:00Z', id: 1 });
  assert.equal(decodeCursor(isoCursor, 'date'), 'invalid');
});

test('decodeCursor rejects out-of-range alarm_level cursor val', () => {
  assert.equal(decodeCursor(encodeCursor({ col: 'alarm_level', val: '6', id: 1 }), 'alarm_level'), 'invalid');
  assert.equal(decodeCursor(encodeCursor({ col: 'alarm_level', val: 'x', id: 1 }), 'alarm_level'), 'invalid');
});

test('decodeCursor rejects PostgREST-injection attempts via enriched_at cursor val', () => {
  // Without the `$` anchor on ISO_TS_RE, a payload like
  // "2026-04-17T00:00:00,and(id.gt.0" would pass validation and inject a second
  // predicate into the `.or()` filter we build in admin-executive-orders/index.ts.
  assert.equal(
    decodeCursor(encodeCursor({ col: 'enriched_at', val: '2026-04-17T00:00:00,and(id.gt.0', id: 'a' }), 'enriched_at'),
    'invalid'
  );
  assert.equal(
    decodeCursor(encodeCursor({ col: 'enriched_at', val: '2026-04-17T00:00:00 OR 1=1', id: 'a' }), 'enriched_at'),
    'invalid'
  );
  // Legit timezone variants still accepted
  assert.deepEqual(
    decodeCursor(encodeCursor({ col: 'enriched_at', val: '2026-04-17T20:30:45.123Z', id: 'eo_a1' }), 'enriched_at'),
    { col: 'enriched_at', val: '2026-04-17T20:30:45.123Z', id: 'eo_a1' }
  );
  assert.deepEqual(
    decodeCursor(encodeCursor({ col: 'enriched_at', val: '2026-04-17T20:30:45+00:00', id: 'eo_a1' }), 'enriched_at'),
    { col: 'enriched_at', val: '2026-04-17T20:30:45+00:00', id: 'eo_a1' }
  );
});

test('decodeCursor rejects bad id types / unsafe chars', () => {
  // Empty / missing / non-string/number
  assert.equal(decodeCursor(encodeCursor({ col: 'date', val: '2024-01-15', id: '' }), 'date'), 'invalid');
  assert.equal(decodeCursor(encodeCursor({ col: 'date', val: '2024-01-15', id: null }), 'date'), 'invalid');
  assert.equal(decodeCursor(encodeCursor({ col: 'date', val: '2024-01-15', id: { x: 1 } }), 'date'), 'invalid');
  // Non-finite numbers (NaN/Infinity serialize as null; null fails String coercion branch anyway)
  assert.equal(decodeCursor(encodeCursor({ col: 'date', val: '2024-01-15', id: Number.NaN }), 'date'), 'invalid');
  // PostgREST-dangerous characters (could break `.or()` predicate parsing if interpolated raw)
  assert.equal(decodeCursor(encodeCursor({ col: 'date', val: '2024-01-15', id: 'eo,evil' }), 'date'), 'invalid');
  assert.equal(decodeCursor(encodeCursor({ col: 'date', val: '2024-01-15', id: 'eo(evil)' }), 'date'), 'invalid');
  assert.equal(decodeCursor(encodeCursor({ col: 'date', val: '2024-01-15', id: 'eo"evil' }), 'date'), 'invalid');
  assert.equal(decodeCursor(encodeCursor({ col: 'date', val: '2024-01-15', id: 'eo.dot' }), 'date'), 'invalid');
  // Length > 50
  assert.equal(decodeCursor(encodeCursor({ col: 'date', val: '2024-01-15', id: 'a'.repeat(51) }), 'date'), 'invalid');
});

// ─── parseId (admin-update-executive-orders) — ID shape validation ─────────
// Mirror of parseId() in admin-update-executive-orders/index.ts. Accepts PROD
// legacy `eo_<ts>_<suffix>` strings AND TEST integer IDs coerced to strings.
const PARSE_ID_RE = /^[A-Za-z0-9_-]{1,50}$/;
function parseId(raw) {
  const s = typeof raw === 'number' ? String(raw) : (typeof raw === 'string' ? raw : null);
  if (s === null || !PARSE_ID_RE.test(s)) return null;
  return s;
}

test('parseId accepts PROD string IDs', () => {
  assert.equal(parseId('eo_1775754706788_9yyufp4qa'), 'eo_1775754706788_9yyufp4qa');
  assert.equal(parseId('eo_1774458464771_xeklz674w'), 'eo_1774458464771_xeklz674w');
});

test('parseId accepts TEST integer IDs (number or string form)', () => {
  assert.equal(parseId(42), '42');
  assert.equal(parseId('42'), '42');
  assert.equal(parseId(1), '1');
});

test('parseId rejects empty / non-alphanumeric / oversize IDs', () => {
  assert.equal(parseId(''), null);
  assert.equal(parseId(null), null);
  assert.equal(parseId(undefined), null);
  assert.equal(parseId({}), null);
  assert.equal(parseId('eo,evil'), null);
  assert.equal(parseId('eo(evil)'), null);
  assert.equal(parseId('eo.dot'), null);
  assert.equal(parseId('eo evil'), null);
  assert.equal(parseId('eo"evil'), null);
  assert.equal(parseId('a'.repeat(51)), null);
});

// ─── Search input validation (Codex P1: PostgREST filter-grammar injection) ───
// Mirror of validateFilters()'s search branch in admin-executive-orders/index.ts.
// The live function interpolates `filters.search` into a PostgREST `.or()` string,
// so characters that alter the filter grammar (`,` `(` `)` `"` backtick `\`) must
// be rejected server-side rather than hoping `%/_/\\` escaping is enough.
const SEARCH_FORBIDDEN_RE = /[,()"`\\]/;
function validateSearch(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return 'filters.search must be a string';
  if (value.length > 200) return 'filters.search must be ≤200 characters';
  if (SEARCH_FORBIDDEN_RE.test(value)) return 'forbidden chars';
  return null;
}

test('validateSearch accepts normal search terms', () => {
  assert.equal(validateSearch(null), null);
  assert.equal(validateSearch(undefined), null);
  assert.equal(validateSearch(''), null);
  assert.equal(validateSearch('schedule g'), null);
  assert.equal(validateSearch('14349'), null);
  assert.equal(validateSearch('DEI rollback'), null);
  assert.equal(validateSearch('labor-management'), null);
});

test('validateSearch rejects PostgREST grammar chars', () => {
  // Injection attempt: craft a search that would break out of ilike and inject
  // a second predicate into the enclosing .or() expression.
  assert.equal(validateSearch('evil,and(id.lt.0'), 'forbidden chars');
  assert.equal(validateSearch('foo(bar)'), 'forbidden chars');
  assert.equal(validateSearch('foo,bar'), 'forbidden chars');
  assert.equal(validateSearch('foo"bar'), 'forbidden chars');
  assert.equal(validateSearch('foo`bar'), 'forbidden chars');
  assert.equal(validateSearch('foo\\bar'), 'forbidden chars');
});

test('validateSearch rejects oversize input', () => {
  assert.equal(validateSearch('a'.repeat(201)), 'filters.search must be ≤200 characters');
  assert.equal(validateSearch('a'.repeat(200)), null); // boundary ok
});

test('validateSearch rejects wrong type', () => {
  assert.equal(validateSearch(42), 'filters.search must be a string');
  assert.equal(validateSearch({ foo: 'bar' }), 'filters.search must be a string');
});

// ─── Tab predicate (plan §6.1: every "List returns only matching predicate" row) ──

test('matchesSubtab — needs_review predicate', () => {
  assert.equal(matchesSubtab({ prompt_version: 'v1', is_public: false, needs_manual_review: true }, null, 'needs_review'), true);
  // Wrong prompt version
  assert.equal(matchesSubtab({ prompt_version: null, is_public: false, needs_manual_review: true }, null, 'needs_review'), false);
  // Already public
  assert.equal(matchesSubtab({ prompt_version: 'v1', is_public: true, needs_manual_review: true }, null, 'needs_review'), false);
  // Not flagged
  assert.equal(matchesSubtab({ prompt_version: 'v1', is_public: false, needs_manual_review: false }, null, 'needs_review'), false);
});

test('matchesSubtab — unenriched predicate', () => {
  assert.equal(matchesSubtab({ prompt_version: null, is_public: false, needs_manual_review: false }, null, 'unenriched'), true);
  assert.equal(matchesSubtab({ prompt_version: 'v0', is_public: false, needs_manual_review: false }, null, 'unenriched'), true);
  assert.equal(matchesSubtab({ prompt_version: 'v1', is_public: false, needs_manual_review: false }, null, 'unenriched'), false);
});

test('matchesSubtab — unpublished predicate', () => {
  assert.equal(matchesSubtab({ prompt_version: 'v1', is_public: false, needs_manual_review: false }, null, 'unpublished'), true);
  assert.equal(matchesSubtab({ prompt_version: 'v1', is_public: false, needs_manual_review: true }, null, 'unpublished'), true); // also unpublished if flagged
  assert.equal(matchesSubtab({ prompt_version: 'v1', is_public: true, needs_manual_review: false }, null, 'unpublished'), false);
  assert.equal(matchesSubtab({ prompt_version: null, is_public: false, needs_manual_review: false }, null, 'unpublished'), false);
});

test('matchesSubtab — published predicate', () => {
  assert.equal(matchesSubtab({ prompt_version: 'v1', is_public: true, needs_manual_review: false }, null, 'published'), true);
  assert.equal(matchesSubtab({ prompt_version: 'v1', is_public: false, needs_manual_review: false }, null, 'published'), false);
});

test('matchesSubtab — failed predicate uses LATEST log status (plan §6.1 "Failed sub-tab uses latest log")', () => {
  // Latest log = failed → IS in Failed
  assert.equal(matchesSubtab({ prompt_version: null, is_public: false, needs_manual_review: false }, 'failed', 'failed'), true);
  // Latest log = completed → NOT in Failed (even if any older log was failed; caller passes only the latest)
  assert.equal(matchesSubtab({ prompt_version: null, is_public: false, needs_manual_review: false }, 'completed', 'failed'), false);
  // Already enriched (v1) → NOT in Failed regardless of log
  assert.equal(matchesSubtab({ prompt_version: 'v1', is_public: false, needs_manual_review: false }, 'failed', 'failed'), false);
});

test('matchesSubtab — all predicate matches everything', () => {
  assert.equal(matchesSubtab({ prompt_version: null, is_public: false, needs_manual_review: false }, null, 'all'), true);
  assert.equal(matchesSubtab({ prompt_version: 'v1', is_public: true, needs_manual_review: false }, 'completed', 'all'), true);
});

// ─── Array compare (plan §6.1: "Array change detection") ───────────────────

test('arraysEqualUnordered — sorts before comparing', () => {
  assert.equal(arraysEqualUnordered(['A', 'B'], ['B', 'A']), true);
  assert.equal(arraysEqualUnordered(['A', 'B', 'C'], ['C', 'A', 'B']), true);
  assert.equal(arraysEqualUnordered([], []), true);
  assert.equal(arraysEqualUnordered(['A'], ['A', 'B']), false);
  assert.equal(arraysEqualUnordered(['A', 'B'], ['A', 'C']), false);
});

// ─── Run ────────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log(`\nadmin-eo-unit: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
