#!/usr/bin/env node
/**
 * Refresh the Tracker's precomputed data (ADO-570, batched since ADO-638).
 *
 * Calls public.refresh_tracker_derived(p_max_rows) (migration 136), which applies
 * the main-line rule to stories.main_line and recomputes tracker_stats. The
 * homepage reads only those precomputed values, so anything that changes
 * stories / fronts / pins / EOs / SCOTUS / pardons must be followed by this.
 *
 * Why batches (ADO-638): the API cancels any statement after about 8 seconds.
 * A normal refresh takes under 1 second, but a backlog (the ADO-594 label
 * backfill left ~3,100 flags to change, ~76 seconds in one UPDATE) made every
 * run time out and roll back from November 10 to 25, 2026. So the script asks
 * for BATCH rows at a time and repeats while the function says more_pending,
 * halving the batch if a call still times out, until caught up or out of time.
 *
 * Call sites — ONE function, every pipeline:
 *   - last step of rss-tracker-{prod,test}.yml, scotus-tracker.yml,
 *     pardons-tracker.yml, executive-orders-tracker.yml (if: always())
 *   - after admin front/pin edits (ADO-547 editor; the fronts seed SQL calls
 *     the function directly)
 *
 * NEVER fails the caller: a refresh error leaves the previous flags in place
 * (stale-but-present beats missing). Exit code is always 0. A failure, or a run
 * that ends with rows still pending, writes a pipeline_skips row (admin Skips
 * tab) AND posts to Discord, because the homepage is stale until it is fixed.
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or the SUPABASE_TEST_* names
 * the SCOTUS workflow uses). Service role is required — anon cannot execute it.
 * DISCORD_WEBHOOK_URL + ALERT_ENV (test = [TEST] title) for the alert.
 *
 * Usage: node scripts/maintenance/refresh-tracker.js
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { recordSkip, PIPELINES, REASONS } from '../lib/skip-reasons.js';
import { postDiscordReported, COLORS } from '../lib/discord.js';
// The batching loop is dependency-free so scripts/fronts/front-agent-db.js can share it.
import { refreshTracker } from '../lib/tracker-refresh.js';

function runLink(env) {
  if (!env.GITHUB_SERVER_URL || !env.GITHUB_REPOSITORY || !env.GITHUB_RUN_ID) return null;
  return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
}

// Title suffix and "View Logs" field shared by both alerts.
function alertContext(env) {
  const where = env.GITHUB_WORKFLOW ? ` (${env.GITHUB_WORKFLOW})` : '';
  const link = runLink(env);
  const fields = link ? [{ name: 'Run', value: `[View Logs](${link})`, inline: true }] : undefined;
  return { where, fields };
}

/** Discord embed: the run ended with rows still waiting (exported for tests). */
export function behindAlert(result, env = process.env) {
  const { where, fields } = alertContext(env);
  return {
    title: `Homepage refresh fell behind${where}`,
    description: `Updated ${result.rows_changed} stories in ${result.calls} batches, but more are still waiting. ` +
      'The homepage main line and counters are partly stale; the next pipeline run continues where this one stopped. ' +
      'If this repeats on every run, see ADO-638 (scripts/maintenance/refresh-tracker.js).',
    color: COLORS.warning,
    fields,
  };
}

/** Discord embed: the refresh stopped on an error (exported for tests). */
export function failedAlert(message, applied, env = process.env) {
  const { where, fields } = alertContext(env);
  const done = applied?.calls > 0
    ? `It updated ${applied.rows_changed} stories in ${applied.calls} batches before the error; the rest of the homepage main line and counters stay stale `
    : 'refresh_tracker_derived() did not finish, so the homepage main line and counters keep their previous values ';
  return {
    title: `Homepage refresh failed${where}`,
    description: `${done}until a run succeeds. Error: ${String(message ?? '').slice(0, 300)}`,
    color: COLORS.error,
    fields,
  };
}

export async function main({ env = process.env, client = null, alert = postDiscordReported, skip = recordSkip, out = console.log, err = console.error } = {}) {
  const url = env.SUPABASE_URL || env.SUPABASE_TEST_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_TEST_SERVICE_KEY;
  if (!client && (!url || !key)) {
    err('refresh-tracker: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipping');
    return;
  }
  const supabase = client ?? createClient(url, key, { auth: { persistSession: false } });
  const alertOpts = { env, envLabel: env.ALERT_ENV };
  const skipRow = (reason, metadata) => skip(supabase, {
    pipeline: PIPELINES.TRACKER_REFRESH, reason, entity_type: 'tracker', entity_id: null, metadata,
  });
  try {
    const r = await refreshTracker(supabase, { log: out });
    // Same first words as before ADO-638: the run-log greps in the handoffs still match.
    out(`refresh_tracker_derived rows_changed=${r.rows_changed} took_ms=${r.took_ms} calls=${r.calls}` +
      `${r.legacy ? ' (migration 136 not applied: one-shot call)' : ''}${r.pending ? ' PENDING' : ''}`);
    if (r.pending) {
      err('refresh-tracker: BEHIND (more rows pending; the next run continues)');
      await skipRow(REASONS.REFRESH_BEHIND, { rows_changed: r.rows_changed, calls: r.calls, batch: r.batch });
      await alert(behindAlert(r, env), alertOpts);
    }
  } catch (e) {
    err(`refresh-tracker: FAILED (previous flags remain): ${e.message}`);
    await skipRow(REASONS.REFRESH_FAILED, { error: String(e.message).slice(0, 500), ...(e.applied ? { applied: e.applied } : {}) });
    await alert(failedAlert(e.message, e.applied, env), alertOpts);
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch(err => {
    console.error(`refresh-tracker: unexpected error: ${err.message}`);
  });
}
