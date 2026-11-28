/**
 * Each daily health check runs once per day, whichever run starts it (ADO-645).
 *
 * Several runs can start the daily checks in rss-health-check.yml: the Netlify daily start (13:23 UTC),
 * a manual run, and every GitHub scheduled run after 14:00 UTC, which offers to as a backup
 * (DAILY_CHECK_FALLBACK=1). A Netlify start that came late, after the fallback had run, used to post
 * the same digest twice (Codex finding 3 on ADO-639). So before it does anything a daily check claims
 * its day in the database table daily_check_claims (migration 139). The claim is atomic: of two runs
 * for the same day, in any order or at the same moment, exactly one gets it. The other records a
 * pipeline_skips row and stops.
 *
 * - A run that fails marks its claim failed, and the next run takes it over.
 * - A claim stuck at running for 30 minutes (the run crashed) is taken over too.
 * - A forced run (the workflow's force input, DAILY_CHECK_FORCE=1) takes the claim whatever its
 *   state: a manual "check again".
 * - Fails open: if the claim cannot be read (database error), the check logs a warning and runs
 *   anyway. A repeated digest beats a missing one.
 *
 * Needs migration 139 on PROD before this code ships (see its APPLY note).
 *
 * Usage (see alert-ingest-health.js):
 *   const result = await runOncePerDay(
 *     { supabase, check: DAILY_CHECKS.INGEST_HEALTH, env, now, log },
 *     () => runTheCheck(),
 *     (r) => r.posted,              // did the check deliver? if not, the day stays open
 *   );
 *   if (result === null) ...         // another run did it today; the skip row is written
 */

import { appendFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { dailySlot, isForcedRun } from './daily-check-window.js';
import { recordSkip, PIPELINES, REASONS } from './skip-reasons.js';

// The check_name values in daily_check_claims
export const DAILY_CHECKS = Object.freeze({
  INGEST_HEALTH: 'ingest_health',   // scripts/monitoring/alert-ingest-health.js
  STORIES_REVIEW: 'stories_review', // scripts/monitoring/alert-needs-review.js --domain stories
});

/**
 * The day a claim is for: the UTC date of the 12:00 UTC boundary that ends the current digest slot
 * (dailySlot). A run at 13:23 UTC on November 27 claims 2026-11-27; a manual run at 10:00 UTC on
 * November 28 claims 2026-11-27 as well, because it reports the same slot.
 */
export function claimSlotDate(now = Date.now()) {
  return dailySlot(now).end.toISOString().slice(0, 10);
}

/** Who holds the claim: the GitHub run and attempt (a re-run is a new attempt), or a local run. */
export function claimRunId(env = process.env, now = Date.now()) {
  if (env.GITHUB_RUN_ID) return `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT || 1}`;
  return `local-${process.pid}-${now}`;
}

/** The client the claim and the skip row use, built from the same credentials as the check. */
export function claimClient({ url, key }) {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * A GitHub fallback run that got the claim did a check Netlify's run should have done (it never
 * started, or its check did not finish). It tells the workflow through a step output, and the
 * workflow's "daily checks ran from the backup run" step posts once. A later fallback run the same
 * day finds the claim taken, so it never warns a second time. A run that could not read the claim
 * says nothing here: it does not know whether it is a backup, and its ::warning:: line already shows.
 */
function noteFallbackRun(env) {
  if (env.DAILY_CHECK_FALLBACK !== '1' || env.GITHUB_EVENT_NAME !== 'schedule' || !env.GITHUB_OUTPUT) return;
  appendFileSync(env.GITHUB_OUTPUT, 'fallback_ran=true\n');
}

// finish() for a run that holds no claim: there is nothing to record
const noFinish = async () => {};

/** A Supabase RPC error as one line for the log */
function rpcFailure(error) {
  return new Error(`${error.code || 'error'} ${error.message}`);
}

// Claim today's run of a daily check (options: see runOncePerDay). run = false: another run did or is
// doing it today, and the skip row is written. finish() never throws: a lost outcome only means the
// claim waits for its 30-minute takeover.
async function claimDailyCheck({ supabase, check, env = process.env, now = Date.now(), log, force = isForcedRun(env) }) {
  const slotDate = claimSlotDate(now);
  const runId = claimRunId(env, now);
  const tag = `[daily-claim] ${check} ${slotDate}`;

  let holder;
  try {
    const { data, error } = await supabase.rpc('claim_daily_check', {
      p_check_name: check, p_slot_date: slotDate, p_run_id: runId, p_force: force,
    });
    if (error) throw rpcFailure(error);
    holder = data?.[0]; // claim_daily_check returns a table: always an array
    if (!holder || typeof holder.claimed !== 'boolean') throw new Error(`unexpected reply ${JSON.stringify(data).slice(0, 200)}`);
  } catch (err) {
    // ::warning:: shows on the workflow run page
    log(`::warning::${tag}: could not claim the day (${err.message}). Running without a claim: if another run also checks today, this posts twice. Is migration 139 applied?`);
    return { run: true, finish: noFinish };
  }

  if (!holder.claimed) {
    log(`${tag}: skipped, run ${holder.holder_run_id} ${holder.holder_status === 'done' ? 'already did this check' : 'is doing this check right now'} (claimed ${holder.holder_claimed_at}). To check again, run the workflow by hand with force.`);
    await recordSkip(supabase, {
      pipeline: PIPELINES.DAILY_HEALTH_CHECK,
      reason: REASONS.ALREADY_CLAIMED,
      entity_type: 'daily_check',
      entity_id: `${check}:${slotDate}`,
      metadata: {
        run_id: runId, event: env.GITHUB_EVENT_NAME || 'local',
        holder_run_id: holder.holder_run_id, holder_status: holder.holder_status, holder_claimed_at: holder.holder_claimed_at,
      },
    });
    return { run: false, finish: noFinish };
  }

  log(`${tag}: claimed by run ${runId}${force ? ' (forced)' : ''}`);
  noteFallbackRun(env);
  return {
    run: true,
    finish: async (status) => {
      try {
        const { data, error } = await supabase.rpc('finish_daily_check', {
          p_check_name: check, p_slot_date: slotDate, p_run_id: runId, p_status: status,
        });
        if (error) throw rpcFailure(error);
        if (data === false) log(`::warning::${tag}: marked ${status} too late, another run had taken the claim over`);
      } catch (err) {
        log(`::warning::${tag}: could not mark the claim ${status} (${err.message}); another run can take it over after 30 minutes`);
      }
    },
  };
}

/**
 * Claim today's run of a daily check, run it, and record how it ended.
 * @template T
 * @param {object} claimOpts - { supabase, check: DAILY_CHECKS.*, env, now, log, force? }; force takes
 *   the claim whatever its state and defaults to DAILY_CHECK_FORCE=1
 * @param {() => Promise<T>} runCheck - the check itself
 * @param {(result: T) => boolean} delivered - did the check get its message out? When not, the claim
 *   is marked failed so a later run today tries again.
 * @returns {Promise<T|null>} the check's result, or null when another run already has today's claim
 */
export async function runOncePerDay(claimOpts, runCheck, delivered) {
  const claim = await claimDailyCheck(claimOpts);
  if (!claim.run) return null;
  try {
    const result = await runCheck();
    await claim.finish(delivered(result) ? 'done' : 'failed');
    return result;
  } catch (err) {
    await claim.finish('failed');
    throw err;
  }
}
