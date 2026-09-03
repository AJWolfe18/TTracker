// ADO-572 AC 2: candidate queries carry the publish gates and never select *.
import assert from 'node:assert/strict';
import { candidateQuery, normalizeCandidate, watermarkKey, TYPES } from '../social/lib/select-candidates.mjs';

assert.deepEqual(TYPES, ['story', 'eo', 'pardon']);

const since = '2026-08-01T00:00:00Z';
const s = candidateQuery('story', since);
assert.ok(s.startsWith('/stories?'));
for (const must of ['main_line=is.true', 'alarm_level=eq.5', 'status=eq.active', 'summary_neutral=not.is.null', `last_updated_at=gt.${encodeURIComponent(since)}`, 'order=last_updated_at.asc', 'limit=50']) {
  assert.ok(s.includes(must), `story query missing ${must}`);
}

const e = candidateQuery('eo', since);
assert.ok(e.startsWith('/executive_orders?'));
for (const must of ['is_public=eq.true', 'alarm_level=eq.5', `updated_at=gt.${encodeURIComponent(since)}`, 'order=updated_at.asc', 'limit=50']) assert.ok(e.includes(must), `eo query missing ${must}`);

const p = candidateQuery('pardon', since);
assert.ok(p.startsWith('/pardons?'));
for (const must of ['is_public=eq.true', 'corruption_level=eq.5', `updated_at=gt.${encodeURIComponent(since)}`, 'limit=50']) assert.ok(p.includes(must), `pardon query missing ${must}`);

for (const q of [s, e, p]) assert.ok(!q.includes('select=*'), 'never select *');
assert.throws(() => candidateQuery('digest', since), /unknown type/);
assert.throws(() => candidateQuery('story'), /sinceIso required/);

// normalisers
assert.deepEqual(
  normalizeCandidate('story', { id: 1, primary_headline: 'H', summary_spicy: 'S.', alarm_level: 5, source_count: 3, last_updated_at: 't' }),
  { id: 1, headline: 'H', spicy: 'S.', alarm: 5, sources: 3, ts: 't' },
);
assert.deepEqual(
  normalizeCandidate('eo', { id: 'eo_1', title: 'T', spicy_summary: 'S.', alarm_level: 5, updated_at: 't' }),
  { id: 'eo_1', headline: 'T', spicy: 'S.', alarm: 5, sources: null, ts: 't' },
);
assert.deepEqual(
  normalizeCandidate('pardon', { id: 9, recipient_name: 'R', summary_spicy: 'S.', corruption_level: 5, updated_at: 't' }),
  { id: 9, headline: 'R', spicy: 'S.', alarm: 5, sources: null, ts: 't' },
);
assert.equal(watermarkKey('eo'), 'draft_watermark_eo');

console.log('social-candidates: ok');
