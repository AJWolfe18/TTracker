#!/usr/bin/env node
/**
 * Backfill executive_orders.date with the Federal Register SIGNING date (ADO-589).
 *
 * The tracker stored publication_date in `date` (the site labels it "Signed"),
 * so every EO showed a date 1-3 days late. This re-reads signing_date from the
 * Federal Register API for every row that has a document_number and patches
 * `date` only where it differs. Rows without a document_number are reported
 * and left alone. Idempotent: a second run changes nothing.
 *
 * One-time data fix: run once per environment, then it is done.
 *
 * Usage:
 *   node scripts/maintenance/backfill-eo-signing-dates.js --env test --dry-run
 *   node scripts/maintenance/backfill-eo-signing-dates.js --env test
 *   node scripts/maintenance/backfill-eo-signing-dates.js --env prod --dry-run
 *   node scripts/maintenance/backfill-eo-signing-dates.js --env prod --confirm-prod
 *
 * --env is REQUIRED so a local .env holding both TEST and PROD keys can never
 * be hit by accident. test reads SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY,
 * prod reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY and needs --confirm-prod.
 *
 * Cost: $0. ~1 Federal Register request per row (free API), 150ms apart.
 * Egress: id + 4 short columns per row, a few KB total.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { resolveBackfillDate } from '../lib/eo-dates.js';

// Workflow logs are this script's only output channel: stdout directly, no console.log in
// production code (AGENTS.md P1; same pattern as scripts/monitoring/alert-routine-silence.js).
// console.error stays for failures so they land on stderr.
const out = (line) => process.stdout.write(`${line}\n`);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const envIdx = args.indexOf('--env');
const ENV = envIdx >= 0 ? args[envIdx + 1] : null;
const PAGE = 200;
const DELAY_MS = 150;

const TEST_REF = 'wnrjrywpcadwutfykflu';

function getClient() {
  if (ENV !== 'test' && ENV !== 'prod') {
    console.error('Usage: --env test|prod [--dry-run] [--confirm-prod]');
    process.exit(2);
  }
  const url = ENV === 'test' ? process.env.SUPABASE_TEST_URL : process.env.SUPABASE_URL;
  const key = ENV === 'test' ? process.env.SUPABASE_TEST_SERVICE_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(`Missing Supabase credentials for --env ${ENV}`);
    process.exit(2);
  }
  const isTestRef = url.includes(TEST_REF);
  if (ENV === 'test' && !isTestRef) {
    console.error('--env test but SUPABASE_TEST_URL is not the TEST project. Refusing.');
    process.exit(2);
  }
  if (ENV === 'prod' && isTestRef) {
    console.error('--env prod but SUPABASE_URL points at the TEST project. Refusing.');
    process.exit(2);
  }
  if (ENV === 'prod' && !DRY_RUN && !args.includes('--confirm-prod')) {
    console.error('Writing to PROD requires --confirm-prod (or use --dry-run).');
    process.exit(2);
  }
  out(`Target: ${ENV.toUpperCase()} (${url.replace(/^https?:\/\//, '').split('.')[0]})${DRY_RUN ? '  [DRY RUN]' : ''}`);
  return createClient(url, key);
}

const FETCH_TIMEOUT_MS = 15000;
const RETRY_BACKOFF_MS = [2000, 8000]; // one-time run: two retries on 429/5xx/network is enough to ride out a rate-limit blip
// Codex P1 (ADO-589): per-row retries alone let a persistent 429 burn ~10s per row
// and hit the workflow's 10-minute limit mid-run with no summary. After this many
// rows in a row exhaust their retries, stop, report where we got to, exit 1.
// Idempotent, so a re-dispatch later resumes safely.
const MAX_CONSECUTIVE_API_FAILURES = 5;

// Code-review finding (ADO-589): without a timeout one hung request stalls the
// workflow step until its 10-minute limit, and without a retry a single 429
// mid-run marks every remaining row api_error and turns the step red half-done.
async function fetchSigningDate(documentNumber) {
  const url = `https://www.federalregister.gov/api/v1/documents/${encodeURIComponent(documentNumber)}.json?fields[]=signing_date&fields[]=publication_date`;
  let lastError = 'unknown';
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS[attempt - 1]));
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'TrumpyTracker/1.0 (https://trumpytracker.com)', Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        const j = await res.json();
        return { signing_date: j.signing_date ?? null, publication_date: j.publication_date ?? null };
      }
      lastError = `HTTP ${res.status}`;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) return { error: lastError, retryable: false }; // 404 etc: retrying will not help
    } catch (err) {
      lastError = err.name === 'TimeoutError' ? `timeout after ${FETCH_TIMEOUT_MS}ms` : (err.message || String(err));
    }
  }
  return { error: `${lastError} (after ${RETRY_BACKOFF_MS.length + 1} attempts)`, retryable: true };
}

// Keyset pagination on the primary key (never OFFSET). id is text on PROD
// ('eo_' + uuid) and integer on TEST; gt() on the last seen id works for both,
// and unlike order_number it is unique and never null, so no row is skipped
// or double-counted at a page boundary.
async function fetchAllRows(supabase) {
  const rows = [];
  let lastId = null;
  for (;;) {
    let q = supabase
      .from('executive_orders')
      .select('id, order_number, document_number, date, publication_date')
      .order('id', { ascending: true })
      .limit(PAGE);
    if (lastId !== null) q = q.gt('id', lastId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data);
    lastId = data[data.length - 1].id;
    if (data.length < PAGE) break;
  }
  rows.sort((a, b) => String(a.order_number ?? '').localeCompare(String(b.order_number ?? '')));
  return rows;
}

async function main() {
  const supabase = getClient();
  const rows = await fetchAllRows(supabase);
  out(`Found ${rows.length} executive orders`);

  const stats = { total: rows.length, updated: 0, already_correct: 0, no_document_number: 0, no_signing_date: 0, invalid_signing_date: 0, api_error: 0, write_error: 0, not_reached: 0 };
  const changes = [];
  let consecutiveApiFailures = 0;
  let aborted = null;

  for (let i = 0; i < rows.length; i++) {
    const eo = rows[i];
    if (!eo.document_number) {
      stats.no_document_number++;
      out(`  skip  EO ${eo.order_number}: no document_number`);
      continue;
    }
    const fr = await fetchSigningDate(eo.document_number);
    await new Promise(r => setTimeout(r, DELAY_MS));
    if (fr.error) {
      stats.api_error++;
      out(`  error EO ${eo.order_number}: Federal Register ${fr.error}`);
      consecutiveApiFailures = fr.retryable ? consecutiveApiFailures + 1 : 0;
      if (consecutiveApiFailures >= MAX_CONSECUTIVE_API_FAILURES) {
        stats.not_reached = rows.length - (i + 1);
        aborted = `stopped after ${consecutiveApiFailures} consecutive Federal Register failures at EO ${eo.order_number} (row ${i + 1} of ${rows.length}); ${stats.not_reached} rows not reached. Re-dispatch later to resume.`;
        break;
      }
      continue;
    }
    consecutiveApiFailures = 0;

    // Never fall back to publication_date here: a rejected signing_date must not
    // overwrite a date that may already be correct (Codex P1).
    const decision = resolveBackfillDate(eo.date, fr.signing_date);
    if (decision.action === 'missing') {
      stats.no_signing_date++;
      out(`  skip  EO ${eo.order_number}: API has no signing_date (keeping ${eo.date})`);
      continue;
    }
    if (decision.action === 'invalid') {
      stats.invalid_signing_date++;
      out(`  skip  EO ${eo.order_number}: API signing_date "${fr.signing_date}" is not a valid YYYY-MM-DD date (keeping ${eo.date})`);
      continue;
    }
    if (decision.action === 'noop') {
      stats.already_correct++;
      continue;
    }
    const wanted = decision.to;
    changes.push({ order_number: eo.order_number, from: eo.date, to: wanted });
    if (DRY_RUN) {
      out(`  would EO ${eo.order_number}: ${eo.date} -> ${wanted}`);
      continue;
    }
    const { error } = await supabase.from('executive_orders').update({ date: wanted }).eq('id', eo.id);
    if (error) {
      stats.write_error++;
      out(`  error EO ${eo.order_number}: write failed: ${error.message}`);
      continue;
    }
    stats.updated++;
    out(`  fixed EO ${eo.order_number}: ${eo.date} -> ${wanted}`);
  }

  out('\nSummary');
  for (const [k, v] of Object.entries(stats)) out(`  ${k.padEnd(20)} ${v}`);
  if (DRY_RUN) out(`  would_update         ${changes.length}`);
  if (aborted) console.error(`\nABORTED: ${aborted}`);
  if (aborted || stats.api_error || stats.write_error) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
