/**
 * ADO-550: Unit tests for the DOJ pardons page parser.
 *
 * The scraper ran green for ~6 months while silently dropping every section
 * whose header used an en dash ("February 12, 2026 – 7 Pardons") instead of
 * the old hyphen. These tests pin both header formats plus the
 * unparsed-header tripwire signal.
 *
 * Run: node scripts/tests/doj-pardons-parser.test.mjs
 */

import assert from 'node:assert/strict';
import { parseDOJHtml } from '../ingest/doj-pardons-scraper.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failed++;
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
  }
}

function personRow(name, href = '/pardon/media/123/dl?inline') {
  return `<tr><td><a href="${href}">${name}</a></td><td>District of Testing</td><td>12 months' imprisonment</td><td>Test offense</td></tr>`;
}

function page(bodyInner) {
  return `<html><body><div class="field-formatter--text-default">${bodyInner}</div></body></html>`;
}

// ---------- Old-format section (hyphen) ----------

test('1. Old-format hyphen header parses', () => {
  const html = page(`
    <h3>January 15, 2026 - 12 Pardons</h3>
    <table><tbody>${personRow('Alice Old')}${personRow('Bob Old')}</tbody></table>
  `);
  const { pardons, unparsedHeaders } = parseDOJHtml(html);
  assert.equal(pardons.length, 2);
  assert.equal(pardons[0].pardon_date, '2026-01-15');
  assert.equal(pardons[0].clemency_type, 'pardon');
  assert.equal(pardons[0].recipient_name, 'Alice Old');
  assert.equal(unparsedHeaders.length, 0);
});

// ---------- New-format sections (en dash) — the ADO-550 bug ----------

test('2. En dash header parses (the section DOJ switched to in 2026)', () => {
  const html = page(`
    <h3>February 12, 2026 – 7 Pardons</h3>
    <table><tbody>${personRow('Travis New')}</tbody></table>
  `);
  const { pardons, unparsedHeaders, newestPageDate } = parseDOJHtml(html);
  assert.equal(pardons.length, 1);
  assert.equal(pardons[0].pardon_date, '2026-02-12');
  assert.equal(newestPageDate, '2026-02-12');
  assert.equal(unparsedHeaders.length, 0);
});

test('3. Em dash and nbsp variants also parse', () => {
  const html = page(`
    <h3>June 4, 2026 — 1 Commutation</h3>
    <table><tbody>${personRow('Carol Em')}</tbody></table>
  `);
  const { pardons, unparsedHeaders } = parseDOJHtml(html);
  assert.equal(pardons.length, 1);
  assert.equal(pardons[0].pardon_date, '2026-06-04');
  assert.equal(pardons[0].clemency_type, 'commutation');
  assert.equal(unparsedHeaders.length, 0);
});

test('4. Mixed old and new sections in one page all parse', () => {
  const html = page(`
    <h3>January 20, 2026 - 3 Pardons (Amended)</h3>
    <table><tbody>${personRow('Old Style')}</tbody></table>
    <h3>July 3, 2026 – 17 Pardons</h3>
    <table><tbody>${personRow('New Style A')}${personRow('New Style B')}</tbody></table>
  `);
  const { pardons, newestPageDate, unparsedHeaders } = parseDOJHtml(html);
  assert.equal(pardons.length, 3);
  assert.deepEqual(pardons.map(p => p.pardon_date), ['2026-01-20', '2026-07-03', '2026-07-03']);
  assert.equal(newestPageDate, '2026-07-03');
  assert.equal(unparsedHeaders.length, 0);
});

// ---------- Tripwire signal ----------

test('5. Date-like header that fails to parse lands in unparsedHeaders and its table is dropped', () => {
  const html = page(`
    <h3>Sometime in 2027 ~ mystery format</h3>
    <table><tbody>${personRow('Dropped Person')}</tbody></table>
  `);
  const { pardons, unparsedHeaders } = parseDOJHtml(html);
  assert.equal(pardons.length, 0);
  assert.equal(unparsedHeaders.length, 1);
  assert.match(unparsedHeaders[0], /2027/);
});

test('6. Non-date h3 (no year) does not trip unparsedHeaders', () => {
  const html = page(`
    <h3>Frequently Asked Questions</h3>
    <h3>January 16, 2026 - 1 Pardon</h3>
    <table><tbody>${personRow('Real Person')}</tbody></table>
  `);
  const { pardons, unparsedHeaders } = parseDOJHtml(html);
  assert.equal(pardons.length, 1);
  assert.equal(unparsedHeaders.length, 0);
});

// ---------- Existing behaviors that must not regress ----------

test('7. Group pardon proclamation paragraph still detected', () => {
  const html = page(`
    <h3>January 20, 2025 - 1 Pardon</h3>
    <p><a href="/some/proclamation">Granting Pardon to Certain Individuals (January 6)</a></p>
  `);
  const { pardons } = parseDOJHtml(html);
  assert.equal(pardons.length, 1);
  assert.equal(pardons[0].recipient_type, 'group');
});

test('8. Rows with fewer than 4 cells and anchor-only h3s are skipped', () => {
  const html = page(`
    <h3></h3>
    <h3>May 27, 2025 - 2 Pardons</h3>
    <table><tbody>
      <tr><td>Incomplete Row</td><td>x</td></tr>
      ${personRow('Complete Row')}
    </tbody></table>
  `);
  const { pardons, unparsedHeaders } = parseDOJHtml(html);
  assert.equal(pardons.length, 1);
  assert.equal(pardons[0].recipient_name, 'Complete Row');
  assert.equal(unparsedHeaders.length, 0);
});

test('9. Warrant relative URL is absolutized and source_key is stable', () => {
  const html = page(`
    <h3>May 27, 2025 - 2 Pardons</h3>
    <table><tbody>${personRow('Url Person', '/pardon/media/999/dl?inline')}</tbody></table>
  `);
  const { pardons } = parseDOJHtml(html);
  assert.equal(pardons[0].primary_source_url, 'https://www.justice.gov/pardon/media/999/dl?inline');
  assert.equal(pardons[0].source_key.length, 16);
});

console.log(`\ndoj-pardons-parser: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
