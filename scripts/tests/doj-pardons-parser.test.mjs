/**
 * ADO-550: Unit tests for the DOJ pardons page parser.
 *
 * The scraper ran green for ~6 months while silently dropping every section
 * whose header used an en dash ("February 12, 2026 – 7 Pardons") instead of
 * the old hyphen. These tests pin both header formats plus the
 * unparsed-header tripwire signal.
 *
 * ADO-590: tests 10-17 pin per-row clemency types in a section whose heading
 * names both types (fixture: the real September 3, 2026 section).
 *
 * Run: node scripts/tests/doj-pardons-parser.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {
  parseDOJHtml,
  clemencyTypeFromWarrantText,
  extractPdfTitle,
  resolveWarrantClemencyType,
  typeRowFromWarrant,
  insertPardons,
} from '../ingest/doj-pardons-scraper.js';
import { PIPELINES, REASONS } from '../lib/skip-reasons.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
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

await test('1. Old-format hyphen header parses', () => {
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

await test('2. En dash header parses (the section DOJ switched to in 2026)', () => {
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

await test('3. Em dash and nbsp variants also parse', () => {
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

await test('4. Mixed old and new sections in one page all parse', () => {
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

await test('5. Date-like header that fails to parse lands in unparsedHeaders and its table is dropped', () => {
  const html = page(`
    <h3>Sometime in 2027 ~ mystery format</h3>
    <table><tbody>${personRow('Dropped Person')}</tbody></table>
  `);
  const { pardons, unparsedHeaders } = parseDOJHtml(html);
  assert.equal(pardons.length, 0);
  assert.equal(unparsedHeaders.length, 1);
  assert.match(unparsedHeaders[0], /2027/);
});

await test('5b. newestPageDate comes from parsed HEADERS, not rows (Codex P1 regression)', () => {
  // Parseable August header whose table rows are malformed (3 cells): section
  // yields zero pardons and unparsedHeaders stays empty. newestPageDate must
  // still report 2026-08-14 so the staleness tripwire can compare against DB.
  const html = page(`
    <h3>January 15, 2026 - 12 Pardons</h3>
    <table><tbody>${personRow('Old Row')}</tbody></table>
    <h3>August 14, 2026 – 5 Pardons</h3>
    <table><tbody><tr><td>Broken Person</td><td>District</td><td>Sentence</td></tr></tbody></table>
  `);
  const { pardons, unparsedHeaders, newestPageDate } = parseDOJHtml(html);
  assert.equal(pardons.length, 1);
  assert.equal(unparsedHeaders.length, 0);
  assert.equal(newestPageDate, '2026-08-14');
});

await test('6. Non-date h3 (no year) does not trip unparsedHeaders', () => {
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

await test('7. Group pardon proclamation paragraph still detected', () => {
  const html = page(`
    <h3>January 20, 2025 - 1 Pardon</h3>
    <p><a href="/some/proclamation">Granting Pardon to Certain Individuals (January 6)</a></p>
  `);
  const { pardons } = parseDOJHtml(html);
  assert.equal(pardons.length, 1);
  assert.equal(pardons[0].recipient_type, 'group');
});

await test('8. Rows with fewer than 4 cells and anchor-only h3s are skipped', () => {
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

await test('9. Warrant relative URL is absolutized and source_key is stable', () => {
  const html = page(`
    <h3>May 27, 2025 - 2 Pardons</h3>
    <table><tbody>${personRow('Url Person', '/pardon/media/999/dl?inline')}</tbody></table>
  `);
  const { pardons } = parseDOJHtml(html);
  assert.equal(pardons[0].primary_source_url, 'https://www.justice.gov/pardon/media/999/dl?inline');
  assert.equal(pardons[0].source_key.length, 16);
});

// ---------- ADO-590: mixed pardon/commutation sections ----------

const SEPT3_COMMUTATIONS = ['Molly Ann Bloom', 'John Dougherty', 'Holly Leanne Frantzen', 'Kevin Harden', 'Jerry Haymon', 'Shemika Alfrida Williams'];
const sept3Section = fs.readFileSync(new URL('./doj-mixed-section-2026-09-03.fixture.html', import.meta.url), 'utf8');
// DOJ drops the link title on some rows (62 of 169 on September 23, 2026): the warrant PDF must decide then
const sept3NoLinkTitles = sept3Section.replace(/ title="[^"]*"/g, '');

// Minimal PDFs shaped like the DOJ warrant scans
function pdf(parts) {
  return Buffer.concat(parts.map(p => (Buffer.isBuffer(p) ? p : Buffer.from(p, 'latin1'))));
}
function directInfoPdf(infoDict) {
  return pdf([`%PDF-1.7\r1 0 obj\r<</Type/Catalog>>\rendobj\r9 0 obj\r${infoDict}\rendobj\rtrailer\r<</Root 1 0 R/Info 9 0 R>>\r%%EOF`]);
}
function objStmInfoPdf(infoDict) {
  const body = `226 0 ${infoDict}`;
  const packed = zlib.deflateSync(Buffer.from(body, 'latin1'));
  return pdf([
    `%PDF-1.7\n50 0 obj\n<</Filter/FlateDecode/First 6/Length ${packed.length}/N 1/Type/ObjStm>>stream\r\n`,
    packed,
    `\r\nendstream\nendobj\n60 0 obj\n<</Type/XRef/Root 1 0 R/Info 226 0 R/Size 227>>stream\r\nendstream\nendobj\n%%EOF`,
  ]);
}
function utf16Hex(text) {
  return Buffer.from(`﻿${text}`, 'utf16le').swap16().toString('hex').toUpperCase();
}
function fakeFetch(routes, calls = []) {
  return async (url) => {
    calls.push(url);
    const route = routes[url];
    if (!route) return new Response('not found', { status: 404 });
    if (route.throws) throw new Error(route.throws);
    const headers = route.filename ? { 'content-disposition': `inline; filename=${route.filename}` } : {};
    return new Response(route.body ?? directInfoPdf('<</Creator(HP Scan)>>'), { status: 200, headers });
  };
}

await test('10. Mixed-heading section (September 3, 2026 fixture) types each row from its warrant link: 23 pardons, 6 commutations', () => {
  const { pardons, unparsedHeaders } = parseDOJHtml(page(sept3Section));
  assert.equal(unparsedHeaders.length, 0);
  assert.equal(pardons.length, 29);
  assert.ok(pardons.every(p => p.pardon_date === '2026-09-03'));
  assert.equal(pardons.filter(p => p.clemency_type === 'pardon').length, 23);
  assert.deepEqual(pardons.filter(p => p.clemency_type === 'commutation').map(p => p.recipient_name).sort(), [...SEPT3_COMMUTATIONS].sort());
});

await test('11. Mixed heading without link titles leaves rows untyped (never the heading type); single-type headings unchanged', () => {
  const { pardons } = parseDOJHtml(page(`${sept3NoLinkTitles}
    <h3>September 8, 2026 - 1 Commutation</h3>
    <table><tbody>${personRow('Heading Typed')}</tbody></table>`));
  const sept3 = pardons.filter(p => p.pardon_date === '2026-09-03');
  assert.equal(sept3.length, 29);
  assert.ok(sept3.every(p => p.clemency_type === null), 'no mixed-section row may take the heading type');
  assert.equal(pardons.find(p => p.recipient_name === 'Heading Typed').clemency_type, 'commutation');
});

await test('12. Warrant labels name the type in every DOJ format seen so far', () => {
  assert.equal(clemencyTypeFromWarrantText('2026-09-03_Pardon_Warrant_Adamiak'), 'pardon');
  assert.equal(clemencyTypeFromWarrantText('2026-09-03_Commutation_Warrant_Bloom.pdf'), 'commutation');
  assert.equal(clemencyTypeFromWarrantText('Commutation Warrant - Larry Hoover_signed 5.28.25'), 'commutation');
  assert.equal(clemencyTypeFromWarrantText('Pardon Warrant - Kentrell Gaulden.signed 5.28.25'), 'pardon');
  assert.equal(clemencyTypeFromWarrantText('2025-05-28 Pardon KEVIN ERIC BAISDEN'), 'pardon');
  assert.equal(clemencyTypeFromWarrantText('2026-09-03 Commutation Warrant Molly Ann Bloom'), 'commutation');
  assert.equal(clemencyTypeFromWarrantText('Pardon and Commutation Warrant'), null, 'both types named');
  assert.equal(clemencyTypeFromWarrantText('Warrant scan 0041'), null, 'no type named');
  assert.equal(clemencyTypeFromWarrantText('Pardonnet Warrant'), null, 'type word inside a name');
  assert.equal(clemencyTypeFromWarrantText(null), null);
});

await test('13. PDF Title is read from a direct Info object, a UTF-16 hex string, a compressed object stream, or XMP', () => {
  assert.equal(extractPdfTitle(directInfoPdf('<</Creator(HP Scan)/Title(2026-09-03 Pardon Warrant Louis Olerio \\(Jr.\\))>>')), '2026-09-03 Pardon Warrant Louis Olerio (Jr.)');
  assert.equal(extractPdfTitle(directInfoPdf(`<</Title<${utf16Hex('2026-09-03 Commutation Warrant Kevin Harden')}>>>`)), '2026-09-03 Commutation Warrant Kevin Harden');
  assert.equal(extractPdfTitle(objStmInfoPdf('<</Creator(HP Scan)/Title(2026-09-03 Commutation Warrant John Dougherty)>>')), '2026-09-03 Commutation Warrant John Dougherty');
  assert.equal(
    extractPdfTitle(pdf(['%PDF-1.7\n<x:xmpmeta><dc:title><rdf:Alt><rdf:li xml:lang="x-default">2026-09-03 Commutation Warrant Jerry Haymon &amp; Co</rdf:li></rdf:Alt></dc:title></x:xmpmeta>\n%%EOF'])),
    '2026-09-03 Commutation Warrant Jerry Haymon & Co',
  );
  // Adamiak's real shape: Info in an object stream with no Title
  assert.equal(extractPdfTitle(objStmInfoPdf("<</CreationDate(D:20260908103313-04'00')/Creator(HP Scan)/Producer(Adobe Acrobat \\(32-bit\\) 26 Paper Capture Plug-in)>>")), null);
  assert.equal(extractPdfTitle(Buffer.from('not a pdf')), null);
});

await test('14. Warrant resolution: PDF Title first, then the download filename; disagreement and failures resolve to null', async () => {
  const u = (n) => `https://www.justice.gov/pardon/media/${n}/dl?inline`;
  const fetchImpl = fakeFetch({
    [u(1)]: { body: directInfoPdf('<</Title(2026-09-03 Commutation Warrant Molly Ann Bloom)>>'), filename: '2026-09-03_Commutation_Warrant_Bloom.pdf' },
    [u(2)]: { body: objStmInfoPdf('<</Creator(HP Scan)>>'), filename: '2026-09-03_Pardon_Warrant_Adamiak.pdf' },
    [u(3)]: { filename: '"Commutation Warrant - Larry Hoover_signed 5.28.25.pdf"' },
    [u(4)]: { body: directInfoPdf('<</Title(2026-09-03 Pardon Warrant X)>>'), filename: '2026-09-03_Commutation_Warrant_X.pdf' },
    [u(5)]: { throws: 'socket hang up' },
    [u(6)]: {},
    [u(7)]: { body: '<html><body>Access denied</body></html>', filename: '2026-09-03_Pardon_Warrant_Bot.pdf' },
  });
  assert.equal((await resolveWarrantClemencyType(u(1), { fetchImpl })).type, 'commutation');
  assert.equal((await resolveWarrantClemencyType(u(2), { fetchImpl })).type, 'pardon');
  assert.equal((await resolveWarrantClemencyType(u(3), { fetchImpl })).type, 'commutation');
  const conflict = await resolveWarrantClemencyType(u(4), { fetchImpl });
  assert.equal(conflict.type, null);
  assert.equal(conflict.retryable, false);
  assert.match(conflict.detail, /disagree/);
  const noType = await resolveWarrantClemencyType(u(6), { fetchImpl });
  assert.equal(noType.retryable, false, 'a readable warrant that names no type is final');
  assert.match(noType.detail, /no type in PDF Title \(none\) or filename \(none\)/);
  // Could not read the warrant this time: retryable, never a type
  const thrown = await resolveWarrantClemencyType(u(5), { fetchImpl });
  assert.deepEqual([thrown.type, thrown.retryable], [null, true]);
  assert.match(thrown.detail, /socket hang up/);
  const http = await resolveWarrantClemencyType(u(404), { fetchImpl });
  assert.deepEqual([http.type, http.retryable], [null, true]);
  assert.match(http.detail, /HTTP 404/);
  const botPage = await resolveWarrantClemencyType(u(7), { fetchImpl });
  assert.deepEqual([botPage.type, botPage.retryable], [null, true], 'a 200 HTML page is not a warrant, even with a typed filename');
  assert.match(botPage.detail, /not a PDF/);
  const calls = [];
  const noLink = await resolveWarrantClemencyType(null, { fetchImpl: fakeFetch({}, calls) });
  assert.deepEqual([noLink.type, noLink.retryable], [null, false]);
  assert.equal(calls.length, 0, 'no fetch without a warrant link');
});

await test('15. Without link titles, the warrant PDFs still type September 3 as 23 pardons and 6 commutations', async () => {
  // Warrant filenames as DOJ serves them (Content-Disposition = the link title + .pdf)
  const routes = {};
  for (const m of sept3Section.matchAll(/href="([^"]+)"[^>]*title="([^"]+)"/g)) {
    routes[`https://www.justice.gov${m[1]}`] = { filename: m[2].endsWith('.pdf') ? m[2] : `${m[2]}.pdf` };
  }
  const { pardons } = parseDOJHtml(page(sept3NoLinkTitles));
  const fetchImpl = fakeFetch(routes);
  for (const p of pardons) assert.equal((await typeRowFromWarrant(p, { fetchImpl })).outcome, 'typed', `${p.recipient_name} was not typed`);
  assert.equal(pardons.filter(p => p.clemency_type === 'pardon').length, 23);
  assert.deepEqual(pardons.filter(p => p.clemency_type === 'commutation').map(p => p.recipient_name).sort(), [...SEPT3_COMMUTATIONS].sort());
});

await test('16. A readable warrant naming no type falls back to pardon; an unreadable one leaves the row untyped for a retry', async () => {
  const row = { recipient_name: 'Nobody Known', clemency_type: null, primary_source_url: 'https://www.justice.gov/pardon/media/7/dl?inline' };
  const result = await typeRowFromWarrant(row, { fetchImpl: fakeFetch({ [row.primary_source_url]: {} }) });
  assert.equal(result.outcome, 'fallback');
  assert.equal(row.clemency_type, 'pardon');
  assert.match(result.detail, /no type in PDF Title/);

  const down = { recipient_name: 'Server Down', clemency_type: null, primary_source_url: 'https://www.justice.gov/pardon/media/8/dl?inline' };
  const retry = await typeRowFromWarrant(down, { fetchImpl: fakeFetch({ [down.primary_source_url]: { throws: 'The operation was aborted due to timeout' } }) });
  assert.equal(retry.outcome, 'retry');
  assert.equal(down.clemency_type, null, 'a guess would be permanent: later runs skip existing rows');
});

await test('17. insertPardons flags a fallback row, holds an unreadable-warrant row for the next run, and fetches warrants for new rows only', async () => {
  const writes = { pardons: [], pipeline_skips: [] };
  const existingKeys = new Set(['dup-key']);
  let nextId = 900;
  const supabase = {
    from(table) {
      const q = { filters: {} };
      q.select = () => q;
      q.eq = (col, val) => { q.filters[col] = val; return q; };
      q.maybeSingle = async () => ({ data: existingKeys.has(q.filters.source_key) ? { id: 1 } : null, error: null });
      q.insert = (row) => { writes[table].push(row); return q; };
      q.single = async () => ({ data: { id: nextId++ }, error: null });
      return q;
    },
  };
  const url = (n) => `https://www.justice.gov/pardon/media/${n}/dl?inline`;
  const calls = [];
  const fetchImpl = fakeFetch({
    [url(1)]: {},
    [url(2)]: { filename: '2026-09-03_Commutation_Warrant_Two.pdf' },
    [url(4)]: { throws: 'The operation was aborted due to timeout' },
  }, calls);
  const rows = [
    { recipient_name: 'Untyped New', clemency_type: null, primary_source_url: url(1), pardon_date: '2026-09-03', source_system: 'doj_opa', source_key: 'k1' },
    { recipient_name: 'Typed By Pdf', clemency_type: null, primary_source_url: url(2), pardon_date: '2026-09-03', source_system: 'doj_opa', source_key: 'k2' },
    { recipient_name: 'Already In Db', clemency_type: null, primary_source_url: url(3), pardon_date: '2026-09-03', source_system: 'doj_opa', source_key: 'dup-key' },
    { recipient_name: 'Warrant Timed Out', clemency_type: null, primary_source_url: url(4), pardon_date: '2026-09-03', source_system: 'doj_opa', source_key: 'k4' },
  ];
  const stats = await insertPardons(supabase, rows, { fetchImpl });
  assert.equal(stats.inserted, 2);
  assert.equal(stats.skipped_duplicate, 1);
  assert.equal(stats.type_fallbacks, 1);
  assert.equal(stats.type_retries, 1);
  assert.deepEqual(writes.pardons.map(p => [p.recipient_name, p.clemency_type]), [['Untyped New', 'pardon'], ['Typed By Pdf', 'commutation']]);
  assert.ok(!calls.includes(url(3)), 'an existing row must not cost a warrant fetch');
  assert.equal(writes.pipeline_skips.length, 2);
  const [fallbackSkip, retrySkip] = writes.pipeline_skips;
  assert.equal(fallbackSkip.pipeline, PIPELINES.PARDONS_INGEST);
  assert.equal(fallbackSkip.reason, REASONS.CLEMENCY_TYPE_UNKNOWN);
  assert.equal(fallbackSkip.entity_type, 'pardon');
  assert.equal(fallbackSkip.entity_id, '900');
  assert.equal(fallbackSkip.metadata.inserted_as, 'pardon');
  assert.equal(fallbackSkip.metadata.warrant_url, url(1));
  assert.equal(retrySkip.pipeline, PIPELINES.PARDONS_INGEST);
  assert.equal(retrySkip.reason, REASONS.API_ERROR);
  assert.equal(retrySkip.entity_id, null, 'held row has no id yet');
  assert.equal(retrySkip.metadata.recipient_name, 'Warrant Timed Out');
  assert.match(retrySkip.metadata.detail, /timeout/);
});

console.log(`\ndoj-pardons-parser: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
