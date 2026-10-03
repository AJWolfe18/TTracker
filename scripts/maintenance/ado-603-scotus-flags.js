#!/usr/bin/env node
/**
 * ADO-603 one-time PROD data fix, run from GitHub Actions (.github/workflows/ado-603-scotus-flags.yml)
 * so it needs no SQL Editor session. Same two changes as
 * scripts/maintenance/2026-10-03-ado-603-scotus-review-flags.sql (test branch):
 *   1. clear the 18 review flags Claude verified as correct (October 3, 2026)
 *   2. re-queue the 18 rows with wrong facts (incl. the stale Louisiana v. Callais write-up) so the
 *      SCOTUS agent rewrites them under the fixed prompt (PR #171)
 *
 * Safe to re-run: each write only touches rows still in the state it expects (still flagged and
 * unreviewed / still enriched and flagged), so a second run changes 0 rows.
 * Refuses to write anything unless all 36 ids still carry the expected case names.
 * Dry run unless --apply.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const CLEAR = [
  [2404, 'Nelsen v. Pike%'], [2400, 'National Republican Congressional%'], [1818, 'Skinner v. Louisiana%'],
  [1798, 'Reed v. Goertz%'], [1797, 'Villarreal v. Alaniz%'], [1781, 'Burnett v. United States%'],
  [1740, 'Klein v. Martin%'], [1736, 'Howell v. Circuit Court%'], [1719, 'Trump v. Orr%'],
  [1711, 'Noem v. National TPS%'], [1710, 'Department of State v. AIDS%'], [1709, 'Trump v. Slaughter%'],
  [1607, 'Trump v. Wilcox%'], [1692, 'Goldey v. Fields%'], [1553, 'Glossip v. Oklahoma%'],
  [1542, 'Bessent v. Dellinger%'], [1533, 'TikTok Inc. v. Garland%'], [1516, 'Republican National Committee v. Genser%'],
];
const REQUEUE = [
  [2403, 'People Not Politicians v. Onder%'], [2052, 'McCarthy v. Hernandez%'], [2050, 'Salda%o v. Texas%'],
  [2049, 'United States v. Carter%'], [2020, 'Alabama v. Powell%'], [2019, 'E.D. v. Noblesville%'],
  [2000, 'Clark v. Mississippi%'], [1937, 'Hamm v. Smith%'], [1932, 'Lairy v. United States%'],
  [1914, 'Guerrero v. Busby%'], [1913, 'Danco Laboratories%'], [1897, 'Callais v. Louisiana%'],
  [1765, 'Mirabelli v. Bonta%'], [1701, 'Trump v. American Federation%'], [1678, 'Louisiana v. Callais%'],
  [1617, 'Doe v. Seattle Police%'], [1593, 'A.A.R.P. v. Trump%'], [1590, 'Noem v. Abrego Garcia%'],
];
const ALREADY_PENDING = [2099, 2399]; // ADO-580 reset, reported only
const NOTE = 'ADO-603 (October 3, 2026): checked by Claude. The vote is counted from the noted dissents, which is how the Court records unsigned orders and cert denials; vote and dissenters checked. Flag cleared, no change to the facts.';

const apply = process.argv.includes('--apply');
const BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const out = (s) => process.stdout.write(`${s}\n`);

/** SQL ILIKE pattern -> case-insensitive anchored RegExp (% = any run, _ = one char) */
export function likeToRegex(pattern) {
  const body = [...pattern].map((c) => (c === '%' ? '.*' : c === '_' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('');
  return new RegExp(`^${body}$`, 'is');
}

async function rest(method, path, body) {
  const res = await fetch(`${BASE}/rest/v1${path}`, {
    method,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : [];
}

const COLS = 'id,case_name,enrichment_status,needs_manual_review,manual_reviewed_at,vote_split,majority_author,dissent_authors,prompt_version,enriched_at';
const ids = (list) => list.map(([id]) => id).join(',');

async function snapshot() {
  const all = [...CLEAR, ...REQUEUE].map(([id]) => id).concat(ALREADY_PENDING);
  return rest('GET', `/scotus_cases?select=${COLS}&id=in.(${all.join(',')})&order=id`);
}

function tally(rows) {
  const t = {};
  for (const r of rows) {
    const k = `${r.enrichment_status} | flagged=${r.needs_manual_review} | reviewed=${r.manual_reviewed_at != null}`;
    t[k] = (t[k] || 0) + 1;
  }
  return Object.entries(t).sort().map(([k, n]) => `  ${k}: ${n}`).join('\n');
}

async function main() {
  if (!BASE || !KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  out(`ADO-603 SCOTUS flag fix - ${apply ? 'APPLY' : 'DRY RUN'}`);

  const before = await snapshot();
  // Rollback record: the pre-change values of every row, in the job log.
  out('BEFORE (rollback record):');
  for (const r of before) out(`  ${JSON.stringify(r)}`);
  out(`BEFORE tally:\n${tally(before)}`);

  const byId = new Map(before.map((r) => [r.id, r]));
  const mismatched = [...CLEAR, ...REQUEUE].filter(([id, like]) => !byId.has(id) || !likeToRegex(like).test(byId.get(id).case_name || ''));
  if (mismatched.length) {
    throw new Error(`id/name guard failed for ${mismatched.map(([id, like]) => `${id} (${like}) = ${byId.get(id)?.case_name ?? 'missing'}`).join('; ')}. Nothing changed.`);
  }
  out('Guard: all 36 ids carry the expected case names.');

  const willClear = CLEAR.filter(([id]) => byId.get(id).needs_manual_review === true && byId.get(id).manual_reviewed_at == null).length;
  const willRequeue = REQUEUE.filter(([id]) => byId.get(id).enrichment_status === 'enriched' && byId.get(id).needs_manual_review === true).length;
  out(`Would clear ${willClear} of 18 flags; would re-queue ${willRequeue} of 18 rows.`);
  if (!apply) { out('Dry run: no writes. Re-run with --apply.'); return; }

  const cleared = await rest('PATCH',
    `/scotus_cases?id=in.(${ids(CLEAR)})&needs_manual_review=is.true&manual_reviewed_at=is.null&select=id`,
    { needs_manual_review: false, manual_reviewed_at: new Date().toISOString(), manual_review_note: NOTE });
  out(`Cleared: ${cleared.length} of 18 (0 means it already ran).`);

  const requeued = await rest('PATCH',
    `/scotus_cases?id=in.(${ids(REQUEUE)})&enrichment_status=eq.enriched&needs_manual_review=is.true&select=id`,
    { enrichment_status: 'pending', enriched_at: null, prompt_version: null });
  out(`Re-queued: ${requeued.length} of 18 (0 means it already ran).`);

  const after = await snapshot();
  out(`AFTER tally (expect enriched/flagged=false/reviewed=true: 18 and pending/flagged=true/reviewed=false: 20):\n${tally(after)}`);
}

if (process.argv[1]?.endsWith('ado-603-scotus-flags.js')) {
  main().catch((err) => { process.stderr.write(`ADO-603 fix FAILED: ${err.message}\n`); process.exit(1); });
}
