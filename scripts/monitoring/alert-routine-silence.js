#!/usr/bin/env node
/**
 * Discord alert when a Claude routine goes silent (ADO-586; SCOTUS, EO, Pardons and fronts added by ADO-624).
 *
 * On September 16, 2026 the PROD Clustering Judge stopped writing and nobody noticed for two
 * days: a denied or dead routine leaves no row, and quiet runs are silent by design (ADO-577).
 * Every routine below leaves a row on EVERY healthy run (a heartbeat row when there is no work),
 * so "no new row" means the routine, or the executor that writes for it, is not running.
 * EO and the Election front agent have no run-level log, so they write one routine_heartbeats row
 * per run (migration 129). SCOTUS and EO run weekdays only: their age leaves out Saturday and
 * Sunday (UTC, the cron's clock), so a weekend never reads as silence.
 *
 * Runs as a step of the 6-hourly health check, on main only (it reads PROD). One Discord message
 * per silent routine per check, no dedup (v1). Fresh logs => no message.
 *
 * Freshness is read as the single newest row (limit=1). Never count or select without a limit:
 * PostgREST stops at 1,000 rows and that produced a false outage alarm on September 17, 2026.
 *
 * Usage: node scripts/monitoring/alert-routine-silence.js
 * Env:   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, DISCORD_WEBHOOK_URL (no URL = no message),
 *        SILENCE_HOURS_<KEY> (optional per-routine override, e.g. SILENCE_HOURS_SCOTUS)
 *
 * Exit codes: 0 when the check RAN (fresh, silent or a failed read - each failed read posts its own
 * Discord message). 1 when the check could not run at all (missing credentials, crash). The workflow
 * step is continue-on-error so the health check stays green, and a follow-up step posts to Discord
 * when this step's outcome is failure - a dead monitor must never be silent.
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { postDiscord, COLORS } from '../lib/discord.js';

export const ROUTINES = Object.freeze([
  {
    key: 'judge',
    label: 'Clustering Judge',
    // source filter: a manual merge from the admin Judge tab also writes here and must not
    // hide a silent agent. The executor writes these rows after each Judge run.
    path: '/clustering_judge_log?select=created_at&source=eq.judge-agent&order=created_at.desc&limit=1',
    hours: 12,
    envOverride: 'SILENCE_HOURS_JUDGE',
    cadence: 'runs 3 times a day; the executor workflow writes its rows',
  },
  {
    key: 'stories',
    label: 'Stories enrichment',
    path: '/stories_enrichment_log?select=created_at&order=created_at.desc&limit=1',
    hours: 6,
    envOverride: 'SILENCE_HOURS_STORIES',
    cadence: 'runs every 2 hours',
  },
  // Daily and weekday routines: 30 hours = one missed run plus slack for a slow or manual run.
  // weekdaysOnly matches the SCOTUS and EO crons ('0 16 * * 1-5', UTC); change both together.
  // run_source filter: only the cloud agent's own rows count, never a manual or workflow row.
  {
    key: 'scotus',
    label: 'SCOTUS enrichment',
    path: '/scotus_enrichment_log?select=ran_at&run_source=eq.cloud-agent&order=ran_at.desc&limit=1',
    hours: 30,
    weekdaysOnly: true,
    envOverride: 'SILENCE_HOURS_SCOTUS',
    cadence: 'runs once each weekday; weekend hours are not counted',
  },
  {
    key: 'eo',
    label: 'EO enrichment',
    path: '/routine_heartbeats?select=created_at&routine=eq.eo&order=created_at.desc&limit=1',
    hours: 30,
    weekdaysOnly: true,
    envOverride: 'SILENCE_HOURS_EO',
    cadence: 'runs once each weekday; weekend hours are not counted',
  },
  {
    key: 'pardons',
    label: 'Pardons enrichment',
    path: '/pardons_enrichment_log?select=ran_at&run_source=eq.cloud-agent&order=ran_at.desc&limit=1',
    hours: 30,
    envOverride: 'SILENCE_HOURS_PARDONS',
    cadence: 'runs once a day',
  },
  {
    key: 'fronts',
    label: 'Election front agent',
    path: '/routine_heartbeats?select=created_at&routine=eq.fronts&order=created_at.desc&limit=1',
    hours: 30,
    envOverride: 'SILENCE_HOURS_FRONTS',
    cadence: 'runs once a day',
  },
]);

// The timestamp column each routine reads is the path's select= (one source, so they cannot drift).
const columnOf = (routine) => new URLSearchParams(routine.path.split('?')[1]).get('select');

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

/** Hours between two instants, leaving out every Saturday and Sunday (UTC) when weekdaysOnly. */
export function silenceHours(fromMs, toMs, weekdaysOnly = false) {
  if (!weekdaysOnly || toMs <= fromMs) return (toMs - fromMs) / HOUR_MS;
  let counted = 0;
  for (let t = fromMs; t < toMs;) {
    const dayEnd = Math.min(toMs, (Math.floor(t / DAY_MS) + 1) * DAY_MS);
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) counted += dayEnd - t;
    t = dayEnd;
  }
  return counted / HOUR_MS;
}

// Josh reads Central time; ISO stays in the log line.
function central(iso) {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT';
}

/**
 * @returns {null | {title, description, color}} null when the routine is fresh
 */
export function buildSilenceAlert(routine, { newestIso, hours, now = Date.now(), readError = null }) {
  if (readError) {
    return {
      title: `${routine.label}: health check could not read its log`,
      description: `The silence check failed to read the log table, so it cannot tell whether the routine is running.\n\n${String(readError).slice(0, 300)}`,
      color: COLORS.error,
    };
  }
  if (!newestIso) {
    return {
      title: `${routine.label} routine is silent`,
      description: `No log row found at all (${routine.cadence}). Check the routine's runs in claude.ai and docs/reference/cloud-classifier-playbook.md.`,
      color: COLORS.error,
    };
  }
  const ageHours = silenceHours(new Date(newestIso).getTime(), now, routine.weekdaysOnly);
  if (ageHours <= hours) return null;
  return {
    title: `${routine.label} routine is silent`,
    description: `No log row for ${Math.floor(ageHours)} ${routine.weekdaysOnly ? 'weekday ' : ''}hours (alert threshold ${hours}; ${routine.cadence}). Last row: ${central(newestIso)}.\n\nCheck the routine's runs in claude.ai first: a run can show green and still have been denied. Triage steps: docs/reference/cloud-classifier-playbook.md.`,
    color: COLORS.error,
  };
}

// Workflow logs are this script's only output channel; stdout directly, no console.log in production code.
const out = (line) => process.stdout.write(`${line}\n`);

export async function runRoutineSilenceAlert({ env = process.env, fetchImpl = globalThis.fetch, log = out, now = Date.now() } = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  const results = [];
  for (const routine of ROUTINES) {
    const hours = Number(env[routine.envOverride]) > 0 ? Number(env[routine.envOverride]) : routine.hours;
    let newestIso = null;
    let readError = null;
    try {
      const res = await fetchImpl(`${url.replace(/\/$/, '')}/rest/v1${routine.path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error(`unexpected response: ${JSON.stringify(rows).slice(0, 200)}`);
      newestIso = rows[0]?.[columnOf(routine)] ?? null;
      // A row whose timestamp cannot be parsed must not read as fresh (or as "NaN hours").
      if (newestIso !== null && Number.isNaN(Date.parse(newestIso))) throw new Error(`unparseable timestamp: ${JSON.stringify(newestIso).slice(0, 80)}`);
    } catch (err) {
      readError = err.message;
    }
    const alert = buildSilenceAlert(routine, { newestIso, hours, now, readError });
    const state = readError ? 'read_failed' : alert ? 'silent' : 'fresh';
    log(`[routine-silence] ${routine.key}: ${state} (newest=${newestIso ?? 'none'}, threshold=${hours}h${readError ? `, error=${readError}` : ''})`);
    const posted = alert ? await postDiscord(alert, { webhookUrl: env.DISCORD_WEBHOOK_URL, fetchImpl }) : false;
    results.push({ key: routine.key, state, posted });
  }
  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runRoutineSilenceAlert()
    .then((r) => { out(`[routine-silence] done: ${r.map((x) => `${x.key}=${x.state}`).join(' ')}`); process.exit(0); })
    // Could not run at all: exit 1 so the workflow's follow-up step reports the dead monitor.
    .catch((err) => { console.error(`[routine-silence] could not run: ${err.message}`); process.exit(1); });
}
