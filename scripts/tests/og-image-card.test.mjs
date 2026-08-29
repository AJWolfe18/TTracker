// ADO-571: pure-function tests for the share-card props mapper + publish-gate parity with og-tags.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCardProps, ROUTES } from '../../netlify/edge-functions/_shared/og-card-props.mjs';

// --- props mapping -----------------------------------------------------------
const story = { id: 16879, primary_headline: 'Judges Fired After Blocking Deportations', alarm_level: 5, category: 'corruption_scandals', last_updated_at: '2026-04-12T15:28:04+00:00' };
const p = buildCardProps('detail', story);
assert.equal(p.headline, story.primary_headline);
assert.equal(p.alarm, 5);
assert.equal(p.label, 'CRISIS');
assert.equal(p.badge, '5 · Constitutional Dumpster Fire');
assert.equal(p.headlineSize, 44);
assert.equal(p.receiptNo, '16879');
assert.equal(p.typeLabel, 'Story');
assert.equal(p.dateText, 'April 12, 2026');

const pardon = { id: 12, recipient_name: 'Someone', corruption_level: 4, primary_connection_type: 'direct', updated_at: '2026-01-05T00:00:00Z' };
const q = buildCardProps('pardons', pardon);
assert.equal(q.alarm, 4);
assert.equal(q.badge, '4 · Cronies-in-Chief');
assert.equal(q.typeLabel, 'Pardon');
assert.equal(q.dateText, 'January 5, 2026');

const eo = { id: 3, title: 'Some Order', alarm_level: 3, updated_at: '2026-02-01T00:00:00Z' };
assert.equal(buildCardProps('eos', eo).badge, '3 · Corporate Giveaway');
assert.equal(buildCardProps('eos', eo).typeLabel, 'Executive Order');

const scotus = { id: 7, case_name_short: 'Trump v. Someone', ruling_impact_level: 5, decided_at: '2026-06-30', updated_at: '2026-07-01T00:00:00Z' };
const s = buildCardProps('scotus', scotus);
assert.equal(s.badge, '5 · Constitutional Crisis');
assert.equal(s.typeLabel, 'SCOTUS');
assert.equal(s.dateText, 'June 30, 2026'); // decided_at wins over updated_at

// headline size steps 44 / 36 / 32
assert.equal(buildCardProps('detail', { primary_headline: 'x'.repeat(90), alarm_level: 5 }).headlineSize, 44);
assert.equal(buildCardProps('detail', { primary_headline: 'x'.repeat(100), alarm_level: 5 }).headlineSize, 36);
assert.equal(buildCardProps('detail', { primary_headline: 'x'.repeat(140), alarm_level: 5 }).headlineSize, 32);

// unknown / missing level falls back to 2 NOTABLE (same as og-tags)
assert.equal(buildCardProps('detail', { alarm_level: 99 }).label, 'NOTABLE');
assert.equal(buildCardProps('detail', { alarm_level: 99 }).badge, '2 · The Great Gaslight');
assert.equal(buildCardProps('detail', {}).headline, 'TrumpyTracker');
assert.equal(buildCardProps('detail', {}).dateText, '');

// no em dashes anywhere in generated text
for (const v of Object.values(p)) assert.ok(!String(v).includes('—'), `em dash in ${v}`);

// --- publish-gate parity with og-tags.ts (AC 2) ------------------------------
const ogTags = readFileSync(new URL('../../netlify/edge-functions/og-tags.ts', import.meta.url), 'utf8');
for (const [type, route] of Object.entries(ROUTES)) {
  const block = ogTags.match(new RegExp(type + String.raw`:\s*\{[\s\S]*?filters:\s*\[([^\]]*)\]`));
  assert.ok(block, `og-tags has no ${type} route`);
  const ogFilters = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual([...route.filters].sort(), ogFilters, `publish gate drift for ${type}`);
  const table = ogTags.match(new RegExp(type + String.raw`:\s*\{\s*table:\s*'([^']+)'`))[1];
  assert.equal(route.table, table, `table drift for ${type}`);
}

// spicy labels come from tone-system.json, never invented
const tone = JSON.parse(readFileSync(new URL('../../public/shared/tone-system.json', import.meta.url), 'utf8')).labels;
const TONE_KEY = { detail: 'stories', eos: 'eos', scotus: 'scotus', pardons: 'pardons' };
for (const [type, key] of Object.entries(TONE_KEY)) {
  for (let lvl = 0; lvl <= 5; lvl++) {
    const row = type === 'pardons' ? { corruption_level: lvl } : type === 'scotus' ? { ruling_impact_level: lvl } : { alarm_level: lvl };
    assert.equal(buildCardProps(type, row).badge, `${lvl} · ${tone[key][String(lvl)].spicy}`, `${type} level ${lvl}`);
  }
}

console.log('og-image-card: ok');
