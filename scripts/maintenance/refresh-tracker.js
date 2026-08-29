#!/usr/bin/env node
/**
 * Refresh the Tracker's precomputed data (ADO-570).
 *
 * Calls public.refresh_tracker_derived() (migration 113), which applies the
 * main-line rule to stories.main_line and recomputes tracker_stats. The
 * homepage reads only those precomputed values, so anything that changes
 * stories / fronts / pins / EOs / SCOTUS / pardons must be followed by this.
 *
 * Call sites — ONE function, every pipeline:
 *   - last step of rss-tracker-{prod,test}.yml, scotus-tracker.yml,
 *     pardons-tracker.yml, executive-orders-tracker.yml (if: always())
 *   - after admin front/pin edits (ADO-547 editor; the fronts seed SQL calls
 *     the function directly)
 *
 * NEVER fails the caller: a refresh error leaves the previous flags in place
 * (stale-but-present beats missing) and writes a pipeline_skips row so it is
 * visible in the admin Skips tab. Exit code is always 0.
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or the SUPABASE_TEST_* names
 * the SCOTUS workflow uses). Service role is required — anon cannot execute it.
 *
 * Usage: node scripts/maintenance/refresh-tracker.js
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { recordSkip, PIPELINES, REASONS } from '../lib/skip-reasons.js';

export async function refreshTracker(supabase) {
  const { data, error } = await supabase.rpc('refresh_tracker_derived');
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return { rows_changed: row?.rows_changed ?? null, took_ms: row?.took_ms ?? null };
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.SUPABASE_TEST_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_TEST_SERVICE_KEY;
  if (!url || !key) {
    console.error('refresh-tracker: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipping');
    return;
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  try {
    const r = await refreshTracker(supabase);
    console.log(`refresh_tracker_derived rows_changed=${r.rows_changed} took_ms=${r.took_ms}`);
  } catch (err) {
    console.error(`refresh-tracker: FAILED (previous flags remain): ${err.message}`);
    await recordSkip(supabase, {
      pipeline: PIPELINES.TRACKER_REFRESH,
      reason: REASONS.REFRESH_FAILED,
      entity_type: 'tracker',
      entity_id: null,
      metadata: { error: String(err.message).slice(0, 500) },
    });
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch(err => {
    console.error(`refresh-tracker: unexpected error: ${err.message}`);
  });
}
