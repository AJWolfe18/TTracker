/**
 * ADO-480 §6.1: Contract smoke tests for admin-executive-orders edge functions.
 *
 * Hits deployed edge functions on TEST. Skips gracefully if env vars unset.
 *
 * Required env vars to actually run:
 *   SUPABASE_TEST_URL              (e.g. https://wnrjrywpcadwutfykflu.supabase.co)
 *   ADMIN_DASHBOARD_PASSWORD       (TEST admin password)
 *
 * Run:
 *   SUPABASE_TEST_URL=... ADMIN_DASHBOARD_PASSWORD=... \
 *   node scripts/tests/admin-eo-contracts.test.mjs
 *
 * NOTE: This is a SMOKE suite — the full §6.1 matrix (33 assertions) is verified
 * via manual UX checks on TEST per §6.3 + §7. This file covers the high-value
 * invariants that catch the SCOTUS regressions baked into the plan:
 *  - Auth required (401 without password)
 *  - Sort parser handles underscored keys (no-crash)
 *  - Date cursor validator rejects ISO timestamps
 *  - counts_by_subtab key set complete
 */

const supabaseUrl = process.env.SUPABASE_TEST_URL;
const adminPassword = process.env.ADMIN_DASHBOARD_PASSWORD;

if (!supabaseUrl || !adminPassword) {
  console.log('admin-eo-contracts: SKIPPED (set SUPABASE_TEST_URL + ADMIN_DASHBOARD_PASSWORD to run)');
  process.exit(0);
}

import assert from 'node:assert/strict';

const FN_LIST = `${supabaseUrl}/functions/v1/admin-executive-orders`;
const FN_UPDATE = `${supabaseUrl}/functions/v1/admin-update-executive-orders`;

async function call(fnUrl, body, opts = {}) {
  const headers = { 'content-type': 'application/json' };
  if (opts.password !== false) {
    headers['x-admin-password'] = opts.password ?? adminPassword;
  }
  const res = await fetch(fnUrl, { method: 'POST', headers, body: JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ─── Auth (plan §6.1 "Auth header required" / "Auth header wrong" / "SCOTUS parity") ──

test('list rejects request with no password (401)', async () => {
  const { status } = await call(FN_LIST, { action: 'list' }, { password: false });
  assert.equal(status, 401);
});

test('list rejects request with wrong password (401 not 403)', async () => {
  // Note: edge function returns 401 for both missing and wrong, since the
  // timing-safe comparison can't distinguish "no password" from "wrong password"
  // at the auth-check layer. SCOTUS parity.
  const { status } = await call(FN_LIST, { action: 'list' }, { password: 'definitely-wrong' });
  assert.equal(status, 401);
});

test('list with correct password returns 200 + counts_by_subtab', async () => {
  const { status, data } = await call(FN_LIST, { action: 'list', subtab: 'all', limit: 5 });
  assert.equal(status, 200, `got ${status}: ${JSON.stringify(data)}`);
  assert.ok(Array.isArray(data.items), 'items should be array');
  assert.ok(data.counts_by_subtab, 'counts_by_subtab should exist');
  for (const key of ['needs_review', 'unenriched', 'unpublished', 'published', 'failed', 'all']) {
    assert.ok(typeof data.counts_by_subtab[key] === 'number', `counts_by_subtab.${key} should be a number`);
  }
});

// ─── Sort + cursor regressions ─────────────────────────────────────────────

test('list accepts underscored sort key (sort=enriched_at-desc) without 400', async () => {
  const { status, data } = await call(FN_LIST, { action: 'list', subtab: 'all', sort: 'enriched_at-desc', limit: 5 });
  assert.equal(status, 200, `got ${status}: ${JSON.stringify(data)}`);
});

test('list rejects malformed cursor with 400', async () => {
  const { status } = await call(FN_LIST, { action: 'list', subtab: 'all', after: '!!!not-a-cursor!!!' });
  assert.equal(status, 400);
});

test('list rejects ISO-timestamp date in cursor (date column is DATE not timestamptz)', async () => {
  // Cursor schema is {col, val, id}. ISO timestamp in `val` for col=date must be rejected.
  const isoCursor = Buffer.from(JSON.stringify({ col: 'date', val: '2024-01-15T00:00:00Z', id: 1 })).toString('base64');
  const { status } = await call(FN_LIST, { action: 'list', subtab: 'all', sort: 'date-desc', after: isoCursor });
  assert.equal(status, 400);
});

test('list rejects cursor whose col mismatches request sort (stale URL guard)', async () => {
  // Cursor was built when sort=date but request now uses sort=alarm_level — must reject.
  const dateCursor = Buffer.from(JSON.stringify({ col: 'date', val: '2024-01-15', id: 1 })).toString('base64');
  const { status } = await call(FN_LIST, { action: 'list', subtab: 'all', sort: 'alarm_level-desc', after: dateCursor });
  assert.equal(status, 400);
});

// ─── Sub-tab predicate sanity ──────────────────────────────────────────────

test('list with subtab=published returns only is_public=true items', async () => {
  const { status, data } = await call(FN_LIST, { action: 'list', subtab: 'published', limit: 10 });
  assert.equal(status, 200);
  for (const item of data.items) {
    assert.equal(item.is_public, true, `published item ${item.id} has is_public=${item.is_public}`);
  }
});

test('list with subtab=unenriched returns only prompt_version != v1', async () => {
  const { status, data } = await call(FN_LIST, { action: 'list', subtab: 'unenriched', limit: 10 });
  assert.equal(status, 200);
  for (const item of data.items) {
    assert.notEqual(item.prompt_version, 'v1', `unenriched item ${item.id} has prompt_version=v1`);
  }
});

// ─── Update validation ─────────────────────────────────────────────────────

test('update rejects request without id (400)', async () => {
  const { status } = await call(FN_UPDATE, { action: 'update', fields: { title: 'x' }, if_updated_at: new Date().toISOString() });
  assert.equal(status, 400);
});

test('update rejects severity_rating in fields payload (server-derived only)', async () => {
  const { status, data } = await call(FN_UPDATE, {
    action: 'update',
    id: 1,  // doesn't matter, validation runs before lookup
    fields: { severity_rating: 'critical' },
    if_updated_at: new Date().toISOString(),
  });
  assert.equal(status, 400);
  assert.ok(/severity_rating/.test(data.error || ''), `error should mention severity_rating: ${data.error}`);
});

test('update rejects is_public in fields payload (use publish action)', async () => {
  const { status, data } = await call(FN_UPDATE, {
    action: 'update',
    id: 1,
    fields: { is_public: true },
    if_updated_at: new Date().toISOString(),
  });
  assert.equal(status, 400);
  assert.ok(/is_public/.test(data.error || ''), `error should mention is_public: ${data.error}`);
});

test('update rejects unknown field with 400', async () => {
  const { status, data } = await call(FN_UPDATE, {
    action: 'update',
    id: 1,
    fields: { not_a_real_field: 'x' },
    if_updated_at: new Date().toISOString(),
  });
  assert.equal(status, 400);
  assert.ok(/not_a_real_field/.test(data.error || ''), `error should mention field name: ${data.error}`);
});

// ─── Bulk publish validation ───────────────────────────────────────────────

test('bulk_publish rejects > 50 items (400)', async () => {
  const items = Array.from({ length: 51 }, (_, i) => ({ id: i + 1, if_updated_at: new Date().toISOString() }));
  const { status } = await call(FN_UPDATE, { action: 'bulk_publish', items });
  assert.equal(status, 400);
});

test('bulk_publish rejects empty items (400)', async () => {
  const { status } = await call(FN_UPDATE, { action: 'bulk_publish', items: [] });
  assert.equal(status, 400);
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

console.log(`\nadmin-eo-contracts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
