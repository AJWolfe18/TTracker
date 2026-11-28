#!/usr/bin/env node
/**
 * Records the SCOTUS backup guard's skip in pipeline_skips (ADO-644, rule from ADO-466: every skip
 * leaves a row). The guard job in .github/workflows/scotus-tracker.yml runs this when a scheduled
 * (backup) run finds that a Netlify-started run already did today's pipeline, and skips it.
 *
 * Never fails the job: recordSkip never throws, and missing credentials only log a warning. The
 * workflow step is continue-on-error as well, so a lost row cannot turn the skip into a second run.
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, GITHUB_RUN_ID, and from the guard's check step
 *      SINCE (start of its 20-hour window) and FETCHED (dispatch runs in it whose fetch step succeeded).
 */

import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { recordSkip, PIPELINES, REASONS } from '../lib/skip-reasons.js';

/** @returns {Promise<boolean>} true when the row was written */
export async function recordBackupSkip({ env = process.env, supabase = null, log = (l) => process.stdout.write(`${l}\n`) } = {}) {
  if (!supabase) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      log('::warning::[scotus-backup-guard] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set: the skip was not recorded');
      return false;
    }
    supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  const written = await recordSkip(supabase, {
    pipeline: PIPELINES.SCOTUS_FETCH,
    reason: REASONS.BACKUP_RUN_SKIPPED,
    entity_type: 'workflow_run',
    entity_id: env.GITHUB_RUN_ID || null,
    metadata: { since: env.SINCE || null, fetched_runs: Number(env.FETCHED) || 0 },
  });
  log(`[scotus-backup-guard] skip ${written ? 'recorded' : 'NOT recorded'} (pipeline_skips scotus_fetch / backup_run_skipped)`);
  return written;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  recordBackupSkip().then(() => process.exit(0));
}
