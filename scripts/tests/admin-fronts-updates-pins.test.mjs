/**
 * ADO-547 AC5 + AC6: the admin Fronts tab's updates and Tracker pin helpers.
 *
 * Imports the real helpers the admin-fronts edge function runs
 * (supabase/functions/admin-fronts/updates-pins.ts; Node strips the TypeScript types),
 * so the field whitelist, the approval stamping, the keyset cursor and the "dead pin" rules
 * tested here are the deployed ones. Also checks the edge function and admin.html contracts
 * (every pin write refreshes the Tracker, labels say "homepage", never "force_show").
 *
 * Run: node scripts/tests/admin-fronts-updates-pins.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const H = await import(new URL('../../supabase/functions/admin-fronts/updates-pins.ts', import.meta.url).href);
const fnSrc = readFileSync(`${repoRoot}supabase/functions/admin-fronts/index.ts`, 'utf8').replace(/\r\n/g, '\n');
const adminHtml = readFileSync(`${repoRoot}public/admin.html`, 'utf8').replace(/\r\n/g, '\n');
const timelineSrc = readFileSync(`${repoRoot}src/lib/timeline.ts`, 'utf8');
const adapterSrc = readFileSync(`${repoRoot}src/lib/adapter.ts`, 'utf8');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const NOW = new Date('2026-10-24T15:00:00Z');
const throwsBad = (fn, re) => assert.throws(fn, (e) => e instanceof H.BadRequest && (!re || re.test(e.message)));

// ---------------- buildUpdatePatch: create ----------------
test('create: whitelisted fields only, inserted approved by a human with decided_at', () => {
  const p = H.buildUpdatePatch({
    headline: '  Court blocks the order ', body: 'Details', happened_at: '2026-10-20T12:00:00Z', significance: 'major',
    // mass-assignment attempts: all ignored
    event_id: 999, approval_state: 'pending', decided_by: 'agent', created_by: 'agent', was_edited: true, sort_key: 9, id: 5, enrichment_meta: {}
  }, null, NOW);
  assert.deepEqual(Object.keys(p).sort(), ['approval_state', 'body', 'created_by', 'decided_at', 'decided_by', 'happened_at', 'headline', 'significance'].sort());
  assert.equal(p.headline, 'Court blocks the order');
  assert.equal(p.approval_state, 'approved');
  assert.equal(p.decided_by, 'human');
  assert.equal(p.created_by, 'human');
  assert.equal(p.decided_at, NOW.toISOString());
  assert.equal(p.happened_at, '2026-10-20T12:00:00.000Z');
  assert.equal(p.significance, 'major');
});

test('create: significance defaults to minor, blank body becomes null', () => {
  const p = H.buildUpdatePatch({ headline: 'x', happened_at: '2026-10-01', body: '   ' }, null, NOW);
  assert.equal(p.significance, 'minor');
  assert.equal(p.body, null);
});

test('create: headline and date are required; bad values are refused', () => {
  throwsBad(() => H.buildUpdatePatch({ happened_at: '2026-10-01' }, null, NOW), /headline is required/);
  throwsBad(() => H.buildUpdatePatch({ headline: '   ', happened_at: '2026-10-01' }, null, NOW), /headline is required/);
  throwsBad(() => H.buildUpdatePatch({ headline: 'x' }, null, NOW), /date it happened is required/);
  throwsBad(() => H.buildUpdatePatch({ headline: 'x', happened_at: 'soon' }, null, NOW), /not a valid date/);
  throwsBad(() => H.buildUpdatePatch({ headline: 'x', happened_at: '2026-11-30' }, null, NOW), /future/);
  throwsBad(() => H.buildUpdatePatch({ headline: 'x', happened_at: '1999-01-01' }, null, NOW), /too far in the past/);
  throwsBad(() => H.buildUpdatePatch({ headline: 'x', happened_at: '2026-10-01', significance: 'huge' }, null, NOW), /major or minor/);
  throwsBad(() => H.buildUpdatePatch({ headline: 'x'.repeat(301), happened_at: '2026-10-01' }, null, NOW), /too long/);
  throwsBad(() => H.buildUpdatePatch({ headline: 7, happened_at: '2026-10-01' }, null, NOW), /must be text/);
});

// ---------------- buildUpdatePatch: edit ----------------
const human = { id: 1, headline: 'Old', body: 'B', happened_at: '2026-10-20T12:00:00+00:00', significance: 'minor', approval_state: 'approved', created_by: 'human', decided_by: 'human' };
const agentDraft = { ...human, approval_state: 'pending', created_by: 'agent', decided_by: null };

test('edit: unchanged fields write nothing (same instant in another format counts as unchanged)', () => {
  assert.deepEqual(H.buildUpdatePatch({ headline: 'Old', body: 'B', happened_at: '2026-10-20T12:00:00.000Z', significance: 'minor', approval_state: 'approved' }, human, NOW), {});
});

test('edit: only changed content goes out; a human row never gets was_edited', () => {
  const p = H.buildUpdatePatch({ headline: 'New', body: 'B' }, human, NOW);
  assert.deepEqual(p, { headline: 'New' });
});

test('edit: changing an agent draft sets was_edited; approving it stamps decided_by human + decided_at', () => {
  const p = H.buildUpdatePatch({ headline: 'Fixed', approval_state: 'approved' }, agentDraft, NOW);
  assert.equal(p.was_edited, true);
  assert.equal(p.approval_state, 'approved');
  assert.equal(p.decided_by, 'human');
  assert.equal(p.decided_at, NOW.toISOString());
});

test('edit: approving an agent draft untouched does not set was_edited', () => {
  const p = H.buildUpdatePatch({ headline: 'Old', approval_state: 'approved' }, agentDraft, NOW);
  assert.equal(p.was_edited, undefined);
  assert.equal(p.approval_state, 'approved');
});

test('edit: hide = rejected (re-stamped); back to pending is refused', () => {
  const p = H.buildUpdatePatch({ approval_state: 'rejected' }, human, NOW);
  assert.deepEqual(p, { approval_state: 'rejected', decided_by: 'human', decided_at: NOW.toISOString() });
  throwsBad(() => H.buildUpdatePatch({ approval_state: 'pending' }, human, NOW), /shown|hidden/);
  // leaving a pending draft pending is fine (no change)
  assert.deepEqual(H.buildUpdatePatch({ approval_state: 'pending' }, agentDraft, NOW), {});
});

test('edit: cannot blank the headline; body can be cleared', () => {
  throwsBad(() => H.buildUpdatePatch({ headline: '' }, human, NOW), /headline is required/);
  assert.deepEqual(H.buildUpdatePatch({ body: '' }, human, NOW), { body: null });
});

// ---------------- story ids ----------------
test('optStoryIds: undefined leaves links alone, [] clears, "#12" and "12" parse, junk refused', () => {
  assert.equal(H.optStoryIds(undefined), undefined);
  assert.deepEqual(H.optStoryIds([]), []);
  assert.deepEqual(H.optStoryIds(['#12', ' 13 ', 12, 14]), [12, 13, 14]);
  throwsBad(() => H.optStoryIds('12'), /list/);
  throwsBad(() => H.optStoryIds(['abc']), /not a story number/);
  throwsBad(() => H.optStoryIds([0]), /not a story number/);
  throwsBad(() => H.optStoryIds(Array.from({ length: 51 }, (_, i) => i + 1)), /at most 50/);
});

// ---------------- keyset cursor ----------------
test('update cursor round-trips the exact Postgres timestamp (microseconds kept)', () => {
  const row = { happened_at: '2026-10-20T12:00:00.123456+00:00', sort_key: 0, id: 42 };
  const c = H.encodeUpdateCursor(row);
  assert.deepEqual(H.parseUpdateCursor(c), { happened_at: row.happened_at, sort_key: 0, id: 42 });
  assert.equal(
    H.updateCursorFilter(H.parseUpdateCursor(c)),
    'happened_at.lt."2026-10-20T12:00:00.123456+00:00",and(happened_at.eq."2026-10-20T12:00:00.123456+00:00",sort_key.lt.0),and(happened_at.eq."2026-10-20T12:00:00.123456+00:00",sort_key.eq.0,id.lt.42)'
  );
  assert.equal(H.parseUpdateCursor(null), null);
  assert.equal(H.parseUpdateCursor(''), null);
});

test('update cursor refuses anything that could inject PostgREST filter text', () => {
  for (const bad of ['x', '2026-10-20|0', '2026-10-20T12:00:00Z|0|1),or(id.gt.0', '2026-10-20T12:00:00Z|a|1', '2026-10-20T12:00:00Z|0|-1', 7]) {
    throwsBad(() => H.parseUpdateCursor(bad));
  }
});

// ---------------- pins: input validation ----------------
test('pin inputs: sources, ids and values are validated', () => {
  assert.equal(H.pinSource('scotus'), 'scotus');
  throwsBad(() => H.pinSource('fronts'), /source must be/);
  assert.equal(H.pinEntityId('stories', '#014830'), '14830');
  assert.equal(H.pinEntityId('pardons', 7), '7');
  assert.equal(H.pinEntityId('eos', 'eo_1737400000_ab12'), 'eo_1737400000_ab12');   // PROD EO ids are text
  assert.equal(H.pinEntityId('eos', '5'), '5');
  throwsBad(() => H.pinEntityId('stories', 'eo_1'), /number/);
  throwsBad(() => H.pinEntityId('stories', '0'), /number/);
  assert.equal(H.pinEntityId('stories', '999999999999999'), '999999999999999');
  throwsBad(() => H.pinEntityId('stories', '1234567890123456'), /number/);   // past 2^53 Number() would round
  throwsBad(() => H.pinEntityId('eos', 'a,b'), /executive order/);
  assert.equal(H.pinEntityKey('0123'), '0123');   // clearing matches the stored text exactly
  throwsBad(() => H.pinEntityKey('1)'), /not valid/);
  assert.equal(H.pinValue('force_hide'), 'force_hide');
  throwsBad(() => H.pinValue('show'), /force_show/);
});

// ---------------- pins: dead pins ----------------
const story = (x = {}) => ({ title: 't', date: '2026-10-01T00:00:00Z', alarm: 4, status: 'active', merged_into_story_id: null, enriched: true, main_line: true, ...x });
const eo = (x = {}) => ({ title: 't', date: '2026-10-01', alarm: 3, is_public: true, ...x });

test('dead pins: missing, closed, merged, unenriched and pre-term stories', () => {
  assert.equal(H.pinStatus('stories', 'force_show', null).dead, true);
  assert.equal(H.pinStatus('stories', 'force_show', story()).dead, false);
  const closed = H.pinStatus('stories', 'force_show', story({ status: 'closed' }));
  assert.equal(closed.dead, true);
  assert.match(closed.reason, /closed/);
  const merged = H.pinStatus('stories', 'force_show', story({ status: 'archived', merged_into_story_id: 77 }));
  assert.equal(merged.dead, true);
  assert.match(merged.reason, /#77/);
  assert.match(H.pinStatus('stories', 'force_show', story({ enriched: false })).reason, /no summary/);
  assert.equal(H.pinStatus('stories', 'force_show', story({ date: '2024-12-31T00:00:00Z' })).dead, true);
  assert.equal(H.pinStatus('stories', 'force_hide', story({ status: 'closed' })).dead, true);
});

test('dead pins: unpublished, pre-term and undecided non-story items; redundant pins get a note', () => {
  assert.equal(H.pinStatus('eos', 'force_show', eo({ is_public: false })).dead, true);
  assert.equal(H.pinStatus('pardons', 'force_show', eo({ date: '2024-06-01' })).dead, true);
  assert.match(H.pinStatus('scotus', 'force_show', eo({ date: null })).reason, /Not decided/);
  const live = H.pinStatus('eos', 'force_show', eo());
  assert.deepEqual(live, { dead: false, reason: null });
  const redundantShow = H.pinStatus('eos', 'force_show', eo({ alarm: 4 }));
  assert.equal(redundantShow.dead, false);
  assert.match(redundantShow.reason, /Already on the homepage/);
  assert.match(H.pinStatus('scotus', 'force_hide', eo({ alarm: null })).reason, /Not on the homepage anyway/);
  assert.deepEqual(H.pinStatus('pardons', 'force_hide', eo({ alarm: 5 })), { dead: false, reason: null });
});

test('helper constants mirror src/lib/timeline.ts', () => {
  assert.match(timelineSrc, new RegExp(`TERM_START = '${H.TERM_START}'`));
  assert.match(timelineSrc, new RegExp(`MAIN_LINE_SOURCE_ALARM = ${H.MAIN_LINE_SOURCE_ALARM};`));
  assert.match(timelineSrc, new RegExp(`tracker_pin\\?select=source,entity_id,pin&order=updated_at.desc&limit=${H.MAX_PINS}`));
  assert.deepEqual([...H.PIN_SOURCES].sort(), ['eos', 'pardons', 'scotus', 'stories']);
  assert.equal(H.storyAlarm(3, 'critical'), 3);
  assert.equal(H.storyAlarm(null, null), 2);
});

test('storyAlarm uses the same severity map as src/lib/adapter.ts (SEVERITY_TO_ALARM)', () => {
  const block = adapterSrc.match(/SEVERITY_TO_ALARM[^=]*=\s*\{([\s\S]*?)\}/);
  assert.ok(block, 'SEVERITY_TO_ALARM not found in src/lib/adapter.ts');
  const pairs = [...block[1].matchAll(/['"]?(\w+)['"]?\s*:\s*(\d+)/g)];
  assert.ok(pairs.length >= 4, 'expected at least four severities');
  for (const [, sev, n] of pairs) assert.equal(H.storyAlarm(null, sev), Number(n), `severity ${sev}`);
});

// ---------------- edge function contract ----------------
const caseBody = (name) => {
  const m = fnSrc.match(new RegExp(`case '${name}': \\{([\\s\\S]*?)\\n        \\}\\n`));
  assert.ok(m, `case '${name}' not found in admin-fronts/index.ts`);
  return m[1];
};

test('every pin write refreshes the Tracker main line', () => {
  assert.match(caseBody('pin_set'), /await refresh\(supabase\)/);
  assert.match(caseBody('pin_clear'), /removed \? await refresh\(supabase\)/);
});

test('update writes go through the whitelist; links write the requested stories before unlinking', () => {
  const save = caseBody('save_update');
  assert.match(save, /buildUpdatePatch\(fields as Record<string, unknown>, current\)/);
  assert.doesNotMatch(save, /\.\.\.fields|\.\.\.body/);
  assert.match(save, /insert\(\{ \.\.\.patch, event_id: eventId \}\)/);
  const link = fnSrc.match(/async function linkStories[\s\S]*?\n\}\n/)[0];
  assert.ok(link.indexOf('event_update_id: updateId') < link.indexOf('event_update_id: null'), 'link must run before unlink');
  // edits are scoped to the front in the request, so a stale screen cannot edit another front's update
  assert.match(save, /\.eq\('id', updateId!\)\.eq\('event_id', eventId\)/);
  assert.match(caseBody('delete_update'), /\.eq\('id', updateId\)\.eq\('event_id', eventId\)/);
});

test('updates list is keyset-paged in timeline order, never OFFSET', () => {
  const body = caseBody('updates');
  assert.match(body, /order\('happened_at', \{ ascending: false \}\)\s*\.order\('sort_key', \{ ascending: false \}\)\s*\.order\('id', \{ ascending: false \}\)/);
  assert.match(body, /q\.or\(updateCursorFilter\(cur\)\)/);
  assert.doesNotMatch(fnSrc, /\.range\(|offset/i);
});

// ---------------- admin.html contract ----------------
test('admin labels say "homepage", not force_show/force_hide', () => {
  const tab = adminHtml.match(/===================== Fronts tab \(ADO-547\)([\s\S]*?)===================== end Fronts tab/);
  assert.ok(tab, 'Fronts tab markers not found');
  assert.match(tab[1], /Always show on homepage/);
  assert.match(tab[1], /Never show on homepage/);
  // the raw values may appear only as quoted values, label-map keys/lookups or in comments,
  // never as text Josh reads
  const code = tab[1]
    .replace(/\/\/[^\n]*/g, '')
    .replace(/(['"])force_(show|hide)\1/g, '')
    .replace(/PIN_LABELS\.force_(show|hide)/g, '')
    .replace(/\bforce_(show|hide):/g, '');
  assert.doesNotMatch(code, /force_(show|hide)/);
});

let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`  ok  ${t.name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${t.name}\n       ${err.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
