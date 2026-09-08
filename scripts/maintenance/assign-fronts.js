#!/usr/bin/env node
/**
 * Sweep unassigned stories into fronts (ADO-581, closes ADO-557).
 *
 * Calls public.assign_fronts_sweep(p_since) (migration 115): a deterministic
 * regex pass over active stories with no story_event row, using the per-front
 * rules stored on events.sweep_* . ON CONFLICT (story_id) DO NOTHING - a hand
 * or agent assignment is never overwritten. The rule text lives in the DB, so
 * tuning recall is an UPDATE on events, not a code change.
 *
 * Call sites - ONE function, every pipeline, BEFORE refresh-tracker.js
 * (the refresh applies the main-line rule, so new members must exist first):
 *   rss-tracker-{prod,test}.yml, scotus-tracker.yml, pardons-tracker.yml,
 *   executive-orders-tracker.yml (if: always()).
 *
 * Window: default 48h lookback on first_seen_at / last_updated_at /
 * last_enriched_at. Wider than the 2h RSS cadence on purpose - a skipped run
 * self-heals and overlap costs nothing (PK dedup). `--all` is the full backfill
 * (the migration-115 PROD step), `--since <iso>` an explicit start.
 *
 * NEVER fails the caller: an error writes a pipeline_skips row
 * (front_assignment / sweep_failed) and exits 0 - a story missing its front for
 * one cycle beats a red pipeline.
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_TEST_*).
 *
 * Usage:
 *   node scripts/maintenance/assign-fronts.js              # last 48h
 *   node scripts/maintenance/assign-fronts.js --hours 168  # last week
 *   node scripts/maintenance/assign-fronts.js --since 2026-07-01T00:00:00Z
 *   node scripts/maintenance/assign-fronts.js --all        # full backfill
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { recordSkip, PIPELINES, REASONS } from '../lib/skip-reasons.js';

export const DEFAULT_LOOKBACK_HOURS = 48;

/**
 * Turn argv into the p_since the RPC wants. null = full backfill.
 * @param {string[]} argv
 * @param {Date} [now]
 * @returns {{ since: string|null, label: string }}
 */
export function parseArgs(argv, now = new Date()) {
  if (argv.includes('--all')) return { since: null, label: 'all active stories' };

  const sinceIdx = argv.indexOf('--since');
  if (sinceIdx !== -1) {
    const raw = argv[sinceIdx + 1];
    const d = raw ? new Date(raw) : null;
    if (!d || Number.isNaN(d.getTime())) throw new Error(`--since needs an ISO timestamp, got "${raw ?? ''}"`);
    return { since: d.toISOString(), label: `since ${d.toISOString()}` };
  }

  let hours = DEFAULT_LOOKBACK_HOURS;
  const hoursIdx = argv.indexOf('--hours');
  if (hoursIdx !== -1) {
    hours = Number(argv[hoursIdx + 1]);
    if (!Number.isFinite(hours) || hours <= 0) throw new Error(`--hours needs a positive number, got "${argv[hoursIdx + 1] ?? ''}"`);
  }
  const since = new Date(now.getTime() - hours * 3600 * 1000).toISOString();
  return { since, label: `last ${hours}h (since ${since})` };
}

/**
 * Run the sweep. Returns { candidates, assigned: { slug: n }, total }.
 * Throws on RPC error - main() turns that into a skip row.
 */
export async function assignFronts(supabase, since) {
  const { data, error } = await supabase.rpc('assign_fronts_sweep', { p_since: since });
  if (error) throw new Error(error.message);
  const rows = Array.isArray(data) ? data : [];
  const assigned = {};
  let candidates = 0;
  let total = 0;
  for (const r of rows) {
    if (r.slug === '_candidates') { candidates = r.assigned ?? 0; continue; }
    assigned[r.slug] = r.assigned ?? 0;
    total += r.assigned ?? 0;
  }
  return { candidates, assigned, total };
}

export function formatResult(r) {
  const parts = Object.entries(r.assigned).map(([slug, n]) => `${slug}=${n}`);
  return `assigned ${r.total} of ${r.candidates} candidates${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.SUPABASE_TEST_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_TEST_SERVICE_KEY;
  if (!url || !key) {
    console.error('assign-fronts: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set - skipping');
    return;
  }
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`assign-fronts: ${err.message}`);
    process.exitCode = 2;   // a bad flag is operator error, not a pipeline condition
    return;
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  try {
    const r = await assignFronts(supabase, args.since);
    console.log(`assign_fronts_sweep ${args.label}: ${formatResult(r)}`);
  } catch (err) {
    console.error(`assign-fronts: FAILED (no assignments made): ${err.message}`);
    await recordSkip(supabase, {
      pipeline: PIPELINES.FRONT_ASSIGNMENT,
      reason: REASONS.SWEEP_FAILED,
      entity_type: 'tracker',
      entity_id: null,
      metadata: { since: args.since, error: String(err.message).slice(0, 500) },
    });
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch(err => {
    console.error(`assign-fronts: unexpected error: ${err.message}`);
  });
}
