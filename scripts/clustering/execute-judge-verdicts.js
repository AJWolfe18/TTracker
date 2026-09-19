#!/usr/bin/env node
/**
 * Clustering Judge executor (ADO-583).
 *
 * WHY THIS EXISTS: since September 16, 2026 the cloud auto-mode classifier denies the Judge
 * routine's own PROD writes (merge_stories, clustering_judge_log inserts) with no change on our
 * side. Prompt reshaping did not help, and routines cannot leave auto mode. So the agent no longer
 * writes to the database at all: it judges the pairs, writes ONE verdict file
 * (judge-inbox/<run_id>.json) and pushes it to a judge-run/<env>/<run_id> branch. The
 * "Clustering Judge Executor" GitHub Actions workflow runs this script on that push with the
 * service key from GitHub secrets and performs every write the agent used to do:
 *
 *   1. merge_stories for `merge` verdicts (live runs only; older story survives - the executor
 *      re-checks first_seen_at itself and flips a swapped survivor/loser; DB-enforced cap of 10 per
 *      run via p_run_id; no chained merges in one run - a story already merged this run is
 *      deferred to the next run)
 *   2. one clustering_judge_log row per verdict (an executed merge is logged the moment it
 *      succeeds, everything else in one bulk insert) - the audit trail behind the admin Judge tab
 *      and the verdict memory of the candidate RPC (migration 106)
 *   3. the heartbeat row for a 0-candidate run
 *   4. one Discord digest of `uncertain` verdicts (non-blocking)
 *
 * Idempotent per run_id: pairs already logged for this run are skipped, and what already MERGED
 * this run is read back from story_merge_audit (the authoritative record, written inside
 * merge_stories), so a re-run of the workflow after a partial failure finishes the run instead of
 * double-logging, re-merging, chaining onto an earlier merge or losing a merged=true row.
 *
 * Usage:  node scripts/clustering/execute-judge-verdicts.js judge-inbox/<run_id>.json
 * Env:    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required)
 *         JUDGE_EXPECTED_ENV = test | prod   (the workflow derives it from the branch name; the
 *                                             file's own `environment` field must agree, and so
 *                                             must SUPABASE_URL - a prod file never runs on TEST)
 *         DISCORD_WEBHOOK_URL                (optional; digest is a no-op without it)
 *
 * Exit codes: 0 = every verdict logged; 1 = validation / environment mismatch / a log write failed
 * after retries (the workflow's failure alert fires). A merge_stories `ok:false` is NOT an exit-1:
 * it is logged as `failed:` and retried next run; a second failure escalates the pair to
 * `uncertain` so it surfaces in the admin Judge tab instead of looping forever. A transport
 * failure (non-2xx, unreadable body) is logged `transient:` and never counts toward escalation -
 * an outage must not turn merge verdicts into settled `uncertain` memory.
 */

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { postDiscord, COLORS } from '../lib/discord.js';

export const SCHEMA = 'judge-verdicts/v1';
export const MERGE_CAP = 10;            // must match migration 101's v_merge_cap
export const TEST_PROJECT_REF = 'wnrjrywpcadwutfykflu'; // TrumpyTracker-Test; a URL without it is PROD
export const RUN_ID_RE = /^judge-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/;
const VERDICTS = new Set(['merge', 'keep', 'uncertain']);
const MAX_VERDICTS = 200;

// ---------------------------------------------------------------------------------------------
// Pure helpers (unit-tested in scripts/tests/judge-executor.test.mjs)
// ---------------------------------------------------------------------------------------------

export function envFromSupabaseUrl(url) {
  return String(url || '').includes(TEST_PROJECT_REF) ? 'test' : 'prod';
}

const isPosInt = (n) => Number.isInteger(n) && n > 0;
const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * Validate the agent-written verdict file. Returns a list of problems (empty = valid).
 * Strict on purpose: this file is the only input to PROD writes.
 */
export function validateVerdictFile(doc, { expectedEnv, supabaseUrl } = {}) {
  const problems = [];
  if (!doc || typeof doc !== 'object') return ['file is not a JSON object'];
  if (doc.schema !== SCHEMA) problems.push(`schema must be "${SCHEMA}" (got ${JSON.stringify(doc.schema)})`);
  if (typeof doc.run_id !== 'string' || !RUN_ID_RE.test(doc.run_id)) problems.push(`run_id must look like judge-YYYY-MM-DDTHH-MM-SS.mmmZ (got ${JSON.stringify(doc.run_id)})`);
  if (doc.environment !== 'test' && doc.environment !== 'prod') problems.push(`environment must be "test" or "prod" (got ${JSON.stringify(doc.environment)})`);
  if (expectedEnv && doc.environment !== expectedEnv) problems.push(`file environment "${doc.environment}" does not match the branch/workflow environment "${expectedEnv}"`);
  if (supabaseUrl && doc.environment && envFromSupabaseUrl(supabaseUrl) !== doc.environment) problems.push(`file environment "${doc.environment}" does not match the SUPABASE_URL this job received (${envFromSupabaseUrl(supabaseUrl)})`);
  if (typeof doc.dry_run !== 'boolean') problems.push('dry_run must be a boolean');
  if (!Array.isArray(doc.verdicts)) { problems.push('verdicts must be an array'); return problems; }
  // Every candidate pair must come back with a verdict; a file cut short (context limit) is rejected whole.
  if (!Number.isInteger(doc.candidates) || doc.candidates !== doc.verdicts.length) problems.push(`candidates (${JSON.stringify(doc.candidates)}) must be an integer equal to the number of verdicts (${doc.verdicts.length})`);
  if (doc.verdicts.length > MAX_VERDICTS) problems.push(`too many verdicts (${doc.verdicts.length} > ${MAX_VERDICTS})`);

  const seen = new Set();
  doc.verdicts.forEach((v, i) => {
    const at = `verdicts[${i}]`;
    if (!v || typeof v !== 'object') { problems.push(`${at} is not an object`); return; }
    if (!isPosInt(v.story_id_a) || !isPosInt(v.story_id_b)) problems.push(`${at}: story_id_a/story_id_b must be positive integers`);
    else {
      if (v.story_id_a === v.story_id_b) problems.push(`${at}: story_id_a equals story_id_b`);
      const k = pairKey(v.story_id_a, v.story_id_b);
      if (seen.has(k)) problems.push(`${at}: duplicate pair ${k}`);
      seen.add(k);
    }
    if (!VERDICTS.has(v.verdict)) problems.push(`${at}: verdict must be merge|keep|uncertain (got ${JSON.stringify(v.verdict)})`);
    if (v.confidence != null && !(typeof v.confidence === 'number' && v.confidence >= 0 && v.confidence <= 1)) problems.push(`${at}: confidence must be null or 0..1`);
    if (typeof v.rationale !== 'string' || !v.rationale.trim()) problems.push(`${at}: rationale must be a non-empty string`);
    if (typeof v.headline_a !== 'string' || typeof v.headline_b !== 'string') problems.push(`${at}: headline_a/headline_b must be strings`);
    if (v.centroid_sim != null && typeof v.centroid_sim !== 'number') problems.push(`${at}: centroid_sim must be null or a number`);
    if (v.evidence_as_of != null && typeof v.evidence_as_of !== 'string') problems.push(`${at}: evidence_as_of must be a string when present`);
    if (v.verdict === 'merge') {
      if (!isPosInt(v.survivor_id) || !isPosInt(v.loser_id)) problems.push(`${at}: merge verdicts need integer survivor_id and loser_id`);
      else if (isPosInt(v.story_id_a) && isPosInt(v.story_id_b)) {
        const pair = new Set([v.story_id_a, v.story_id_b]);
        if (v.survivor_id === v.loser_id || !pair.has(v.survivor_id) || !pair.has(v.loser_id)) problems.push(`${at}: survivor_id/loser_id must be the two stories of the pair`);
      }
    }
  });
  return problems;
}

/**
 * Decide what to do with one `merge` verdict given the run so far.
 * `touched` = story ids already involved in an EXECUTED merge this run (no chained merges: a
 * survivor that just absorbed one story is not merged again until a later run re-judges it with
 * its new membership; a story tombstoned this run is never a target).
 */
export function mergeDecision({ dryRun, executed, cap = MERGE_CAP, touched, survivorId, loserId }) {
  if (dryRun) return { action: 'log', reason: 'dry_run' };
  if (executed >= cap) return { action: 'log', reason: 'cap_reached' };
  if (touched.has(survivorId) || touched.has(loserId)) return { action: 'log', reason: 'chained' };
  return { action: 'merge' };
}

/**
 * Survivor orientation is not trusted from the agent: the older story (smaller first_seen_at, tie or
 * unreadable timestamp -> smaller id) survives, because the survivor keeps the public URL. `rows` =
 * [{id, first_seen_at}] for the pair. Returns null when either story is missing (merge_stories then
 * reports loser_not_found / survivor_not_found itself).
 */
export function chooseSurvivor(rows, idA, idB) {
  const a = (rows || []).find((r) => r.id === idA);
  const b = (rows || []).find((r) => r.id === idB);
  if (!a || !b) return null;
  const ta = Date.parse(a.first_seen_at); const tb = Date.parse(b.first_seen_at);
  const aOlder = Number.isNaN(ta) || Number.isNaN(tb) || ta === tb ? idA < idB : ta < tb;
  return aOlder ? { survivorId: idA, loserId: idB } : { survivorId: idB, loserId: idA };
}

/** Shape one clustering_judge_log row (migration 100/104/105/106 columns). */
export function buildLogRow(v, { runId, verdict = v.verdict, merged = false, dryRun, rationale = v.rationale }) {
  const row = {
    source: 'judge-agent',
    run_id: runId,
    story_id_a: v.story_id_a,
    story_id_b: v.story_id_b,
    headline_a: v.headline_a,
    headline_b: v.headline_b,
    verdict,
    confidence: v.confidence ?? null,
    rationale,
    centroid_sim: v.centroid_sim ?? null,
    merged,
    dry_run: dryRun,
  };
  if (v.evidence_as_of) row.evidence_as_of = v.evidence_as_of; // echoed verbatim from the candidate RPC
  return row;
}

export function heartbeatRow(runId, dryRun) {
  return { source: 'judge-agent', story_id_a: null, story_id_b: null, run_id: runId, dry_run: dryRun, merged: false, rationale: 'Healthy empty run - 0 candidate pairs' };
}

/** Rationale prefixes are contractual: verdict memory (mig 106) ignores merge/merged=false rows, and
 *  the twice-failed escalation below looks for `failed:` only (`transient:` never escalates).
 *  `reason` is a mergeDecision reason: dry_run | cap_reached | chained. */
export const deferredRationale = (reason, v, extra) => {
  if (reason === 'dry_run') return v.rationale;
  if (reason === 'cap_reached') return `deferred: run cap of ${MERGE_CAP} reached - ${v.rationale}`;
  return `deferred: chained merge (story ${extra} already merged this run) - ${v.rationale}`;
};

export function buildDigest(uncertain, { runId, env }) {
  if (!uncertain.length) return null;
  const where = env === 'prod'
    ? 'Review + resolve in the PROD admin Judge tab (uncertain filter): https://trumpytracker.com/admin.html'
    : 'Review + resolve in the TEST admin Judge tab (uncertain filter).';
  const lines = uncertain.map((r) => `• #${r.story_id_a} vs #${r.story_id_b}  (conf ${r.confidence ?? 'n/a'}, sim ${r.centroid_sim ?? 'n/a'})\n    A: ${r.headline_a}\n    B: ${r.headline_b}\n    ↳ ${r.rationale}`);
  return {
    title: `🟡 Clustering Judge — ${uncertain.length} uncertain verdict(s) need review`,
    description: `${where}\n\`${runId}\`\n\n${lines.join('\n\n')}`,
    color: COLORS.warning,
  };
}

// ---------------------------------------------------------------------------------------------
// PostgREST client (tiny, injectable for tests)
// ---------------------------------------------------------------------------------------------

export function makeClient({ supabaseUrl, serviceKey, fetchImpl = globalThis.fetch }) {
  const base = `${supabaseUrl.replace(/\/$/, '')}/rest/v1`;
  const headers = (extra = {}) => ({
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...extra,
  });
  async function call(method, path, { body, prefer } = {}) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: headers(prefer ? { Prefer: prefer } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, ok: res.ok, json, text };
  }
  return {
    get: (path) => call('GET', path),
    rpc: (name, args) => call('POST', `/rpc/${name}`, { body: args }),
    insert: (table, rows) => call('POST', `/${table}`, { body: rows, prefer: 'return=minimal' }), // rows are never read back; still 201
  };
}

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------

/**
 * Insert log rows with the Section-5 retry ladder: once as-is, once with evidence_as_of removed
 * (recovers a mangled watermark echo), then give up. Bulk inserts are all-or-nothing, so a retry
 * never double-inserts.
 */
async function insertLogRows(client, rows, log) {
  if (!rows.length) return true;
  let r = await client.insert('clustering_judge_log', rows);
  if (r.status === 201) return true;
  log(`log insert failed (${r.status}) ${String(r.text).slice(0, 300)} - retrying once as-is`);
  r = await client.insert('clustering_judge_log', rows);
  if (r.status === 201) return true;
  log(`log insert failed again (${r.status}) - retrying once without evidence_as_of`);
  r = await client.insert('clustering_judge_log', rows.map(({ evidence_as_of, ...rest }) => rest));
  if (r.status === 201) return true;
  log(`log insert failed (${r.status}) ${String(r.text).slice(0, 300)} - giving up`);
  return false;
}

/** Has this pair already failed a merge before (any earlier run)? Then this failure escalates. */
async function pairFailedBefore(client, a, b, runId) {
  const q = `/clustering_judge_log?select=id&verdict=eq.merge&merged=is.false&rationale=like.failed:*&run_id=neq.${encodeURIComponent(runId)}&or=(and(story_id_a.eq.${a},story_id_b.eq.${b}),and(story_id_a.eq.${b},story_id_b.eq.${a}))&limit=1`;
  const r = await client.get(q);
  return r.ok && Array.isArray(r.json) && r.json.length > 0;
}

export async function executeVerdicts(doc, { client, env, discord = postDiscord, log = console.log }) {
  const { run_id: runId, dry_run: dryRun, verdicts } = doc;
  const summary = { run_id: runId, env, dry_run: dryRun, verdicts: verdicts.length, merged: 0, deferred: 0, failed: 0, escalated: 0, transient: 0, recovered: 0, flipped: 0, skipped_logged: 0, logged: 0, heartbeat: false, digest_sent: false };

  // Idempotency: what did an earlier attempt of this run already log?
  const existing = await client.get(`/clustering_judge_log?select=story_id_a,story_id_b&run_id=eq.${encodeURIComponent(runId)}&limit=1000`);
  if (!existing.ok || !Array.isArray(existing.json)) throw new Error(`could not read existing log rows for ${runId}: ${existing.status} ${String(existing.text).slice(0, 200)}`);
  const alreadyLogged = new Set();
  let heartbeatExists = false;
  for (const r of existing.json) {
    if (r.story_id_a == null && r.story_id_b == null) heartbeatExists = true;
    else alreadyLogged.add(pairKey(r.story_id_a, r.story_id_b));
  }

  // Empty run -> heartbeat only (the ONLY row with both ids NULL; unique per run_id).
  if (verdicts.length === 0) {
    if (heartbeatExists) { log(`heartbeat for ${runId} already present`); summary.heartbeat = true; return summary; }
    if (!(await insertLogRows(client, [heartbeatRow(runId, dryRun)], log))) throw new Error('heartbeat insert failed');
    summary.heartbeat = true; summary.logged = 1;
    log(`heartbeat row written for ${runId}`);
    return summary;
  }

  // Re-run state comes from story_merge_audit, not from the log: merge_stories writes the audit row
  // in the same transaction as the merge, so it is the authoritative record of what merged under
  // this run_id even when the log insert that should have followed never landed.
  const auditPath = `/story_merge_audit?select=loser_id,survivor_id&run_id=eq.${encodeURIComponent(runId)}&limit=1000`;
  const touched = new Set();
  const mergedThisRun = new Set();
  if (!dryRun) {
    const audit = await client.get(auditPath);
    if (!audit.ok || !Array.isArray(audit.json)) throw new Error(`could not read story_merge_audit for ${runId}: ${audit.status} ${String(audit.text).slice(0, 200)}`);
    for (const m of audit.json) {
      mergedThisRun.add(pairKey(m.loser_id, m.survivor_id));
      touched.add(m.loser_id); touched.add(m.survivor_id);
    }
  }
  let executed = mergedThisRun.size; // counts toward the cap, exactly as the DB counts it
  const bulk = [];
  const unconfirmed = []; // merge calls whose response never arrived readable
  const uncertainForDigest = [];

  for (const v of verdicts) {
    const key = pairKey(v.story_id_a, v.story_id_b);
    // No pipeline_skips row for this skip (exemption from the ADO-466 rule, review finding 7): the
    // pair is skipped BECAUSE its clustering_judge_log row for this run already exists - that row is
    // the record, so nothing goes unobserved. Deferred / failed / transient merges are not skips
    // either: each gets its own log row with a contractual rationale prefix.
    if (alreadyLogged.has(key)) { summary.skipped_logged++; log(`pair ${key} already logged for this run - skipping`); continue; }

    if (mergedThisRun.has(key)) {
      // An earlier attempt of this run executed this merge but died before its log row landed.
      // Write the merged=true row now - the admin tab's one-click unmerge is driven from it.
      if (!(await insertLogRows(client, [buildLogRow(v, { runId, dryRun, verdict: 'merge', merged: true })], log))) throw new Error(`recovered merge ${key} could not be logged`);
      summary.recovered++; summary.logged++;
      log(`pair ${key} merged in an earlier attempt of this run - merged=true row written`);
      continue;
    }

    if (v.verdict !== 'merge') {
      bulk.push(buildLogRow(v, { runId, dryRun }));
      if (v.verdict === 'uncertain') uncertainForDigest.push(v);
      continue;
    }

    const d = mergeDecision({ dryRun, executed, touched, survivorId: v.survivor_id, loserId: v.loser_id });
    if (d.action === 'log') {
      const which = d.reason === 'chained' ? (touched.has(v.survivor_id) ? v.survivor_id : v.loser_id) : undefined;
      bulk.push(buildLogRow(v, { runId, dryRun, rationale: deferredRationale(d.reason, v, which) }));
      if (d.reason !== 'dry_run') summary.deferred++;
      continue;
    }

    // Live merge. Older story survives: checked here against first_seen_at, not taken from the
    // agent - a swapped survivor_id would tombstone the older story, which owns the public URL.
    let survivorId = v.survivor_id; let loserId = v.loser_id; let rationale = v.rationale;
    const ages = await client.get(`/stories?select=id,first_seen_at&id=in.(${v.story_id_a},${v.story_id_b})`);
    if (!ages.ok || !Array.isArray(ages.json)) {
      summary.transient++;
      log(`merge ${loserId} -> ${survivorId} not attempted: stories read failed (http_${ages.status})`);
      bulk.push(buildLogRow(v, { runId, dryRun, rationale: `transient: http_${ages.status} reading stories - ${v.rationale}` }));
      continue;
    }
    const oriented = chooseSurvivor(ages.json, v.story_id_a, v.story_id_b);
    if (oriented && oriented.survivorId !== survivorId) {
      ({ survivorId, loserId } = oriented);
      summary.flipped++;
      rationale = `${v.rationale} [executor: survivor/loser flipped - story ${survivorId} is older]`;
      log(`orientation flipped: ${survivorId} is older than ${loserId}`);
    }

    // p_run_id lets the DB enforce the per-run cap (migration 101).
    const res = await client.rpc('merge_stories', { p_loser_id: loserId, p_survivor_id: survivorId, p_run_id: runId });
    const body = res.json && typeof res.json === 'object' ? res.json : {};
    if (res.ok && body.ok === true && body.skipped === false) {
      executed++; summary.merged++;
      touched.add(survivorId); touched.add(loserId);
      log(`merged ${loserId} -> ${survivorId}`);
      // Log the executed merge immediately: the admin tab's one-click unmerge is driven from this row.
      if (!(await insertLogRows(client, [buildLogRow(v, { runId, dryRun, merged: true, rationale })], log))) throw new Error(`executed merge ${loserId}->${survivorId} could not be logged`);
      summary.logged++;
      continue;
    }

    // Transport failure (non-2xx, or a 2xx whose body is not merge_stories' {ok:...} shape): nothing
    // is known about the pair, so it must not count toward the failed-twice escalation - an outage
    // would otherwise turn every merge verdict into settled `uncertain` memory.
    if (!res.ok || typeof body.ok !== 'boolean') {
      const why = res.ok ? 'unreadable_response' : `http_${res.status}`;
      summary.transient++;
      log(`merge ${loserId} -> ${survivorId} transient failure: ${why}`);
      const row = buildLogRow(v, { runId, dryRun, rationale: `transient: ${why} - ${v.rationale}` });
      bulk.push(row); unconfirmed.push({ key, row, rationale });
      continue;
    }

    const reason = body.reason || (body.skipped ? 'loser_already_merged' : 'unknown');
    if (body.ok === true && body.skipped === true) {
      bulk.push(buildLogRow(v, { runId, dryRun, rationale: `skipped: ${reason} - ${v.rationale}` }));
      log(`merge ${loserId} -> ${survivorId} skipped: ${reason}`);
      continue;
    }
    if (reason === 'run_merge_cap_reached') {
      bulk.push(buildLogRow(v, { runId, dryRun, rationale: deferredRationale('cap_reached', v) }));
      summary.deferred++; executed = MERGE_CAP; // the DB says we are at the cap - stop trying
      continue;
    }
    summary.failed++;
    log(`merge ${loserId} -> ${survivorId} failed: ${reason}`);
    if (await pairFailedBefore(client, v.story_id_a, v.story_id_b, runId)) {
      // Second failure: stop retrying every run, hand it to a human as `uncertain` (settled memory).
      summary.escalated++;
      const row = buildLogRow(v, { runId, dryRun, verdict: 'uncertain', rationale: `escalated: merge failed twice (${reason}) - ${v.rationale}` });
      bulk.push(row); uncertainForDigest.push({ ...v, rationale: row.rationale });
    } else {
      bulk.push(buildLogRow(v, { runId, dryRun, rationale: `failed: ${reason} - ${v.rationale}` }));
    }
  }

  // A lost response does not prove the merge did not commit. story_merge_audit is the authority:
  // a pair found there is logged merged=true, not transient (best effort - a failed read leaves the
  // transient rows as they are, and the next run sees the tombstone as `skipped:`).
  if (unconfirmed.length) {
    const audit = await client.get(auditPath);
    const done = new Set(audit.ok && Array.isArray(audit.json) ? audit.json.map((m) => pairKey(m.loser_id, m.survivor_id)) : []);
    for (const u of unconfirmed) {
      if (!done.has(u.key)) continue;
      u.row.merged = true; u.row.rationale = u.rationale;
      summary.transient--; summary.recovered++;
      log(`pair ${u.key}: merge response was lost but story_merge_audit shows it committed - logged merged=true`);
    }
  }

  if (!(await insertLogRows(client, bulk, log))) throw new Error(`bulk log insert of ${bulk.length} rows failed`);
  summary.logged += bulk.length;

  const digest = buildDigest(uncertainForDigest, { runId, env });
  if (digest) summary.digest_sent = await discord(digest);

  log(`done ${JSON.stringify(summary)}`);
  return summary;
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/clustering/execute-judge-verdicts.js <judge-inbox/run_id.json>'); process.exit(1); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JUDGE_EXPECTED_ENV } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required'); process.exit(1); }

  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`cannot read ${file}: ${e.message}`); process.exit(1); }

  const problems = validateVerdictFile(doc, { expectedEnv: JUDGE_EXPECTED_ENV, supabaseUrl: SUPABASE_URL });
  const fileRunId = file.replace(/^.*[\\/]/, '').replace(/\.json$/, '');
  if (doc && doc.run_id && fileRunId !== doc.run_id) problems.push(`file name ${fileRunId} does not match run_id ${doc.run_id}`);
  if (problems.length) { console.error('verdict file rejected:\n - ' + problems.join('\n - ')); process.exit(1); }

  const client = makeClient({ supabaseUrl: SUPABASE_URL, serviceKey: SUPABASE_SERVICE_ROLE_KEY });
  console.log(`executing ${doc.verdicts.length} verdict(s) for ${doc.run_id} on ${doc.environment} (dry_run=${doc.dry_run})`);
  try {
    await executeVerdicts(doc, { client, env: doc.environment });
  } catch (e) {
    console.error(`executor failed: ${e.message}`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
