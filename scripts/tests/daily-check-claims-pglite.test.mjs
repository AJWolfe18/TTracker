// ADO-645: each daily health check runs once per day, whichever run starts it.
// Runs migration 139 (daily_check_claims) on PGlite (real Postgres 17), then:
//   1. the SQL: claim, duplicate, done, failed and stale takeovers, force, finish rules, grants, re-apply
//   2. the real checks (Stories digest, ingest health) against that database through a small
//      supabase-like adapter: two runs for one day post once (in order, overlapping, fallback first and
//      Netlify late), the second records a pipeline_skips row; a failed run or a stale claim does not
//      block a later run; force runs again; a database without the migration fails open.
// SKIPS (exit 0) when @electric-sql/pglite is missing (not a declared dependency).
// Run: node scripts/tests/daily-check-claims-pglite.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runNeedsReviewAlert } from '../monitoring/alert-needs-review.js';
import { runIngestHealth } from '../monitoring/alert-ingest-health.js';
import { claimSlotDate, claimRunId } from '../lib/daily-check-claim.js';
import { migration, pgliteOrSkip } from './fixtures/pglite.mjs';

const out = (s) => process.stdout.write(`${s}\n`);
const PGlite = await pgliteOrSkip('daily-check-claims-pglite');

const M139 = migration('139_daily_check_claims.sql');
const SCHEMA = String.raw`
create role anon; create role authenticated; create role service_role;
create table public.pipeline_skips(id bigserial primary key, pipeline text not null, reason text not null,
  entity_type text, entity_id text, metadata jsonb, created_at timestamptz not null default now());
`;

const db = new PGlite();
await db.exec(SCHEMA);

const claim = async (check, slot, run, force = false) =>
  (await db.query('select * from public.claim_daily_check($1, $2, $3, $4)', [check, slot, run, force])).rows[0];
const finish = async (check, slot, run, status) =>
  (await db.query('select public.finish_daily_check($1, $2, $3, $4) as ok', [check, slot, run, status])).rows[0].ok;
const row = async (check, slot) =>
  (await db.query('select status, run_id, attempts from public.daily_check_claims where check_name = $1 and slot_date = $2', [check, slot])).rows[0];
const skipRows = async () =>
  (await db.query(`select pipeline, reason, entity_type, entity_id, metadata from public.pipeline_skips order by id`)).rows;

// ---------------------------------------------------------------- 1. the SQL
out('1. migration + SQL rules');
{
  const results = await db.exec(M139);
  const final = results.at(-1).rows[0];
  assert.deepEqual(final, { claims_table: 1, rls_on: true, anon_can_select: false, anon_can_claim: false, service_can_claim: true, service_can_finish: true });
  // idempotent: a second apply changes nothing and reports the same
  assert.deepEqual((await db.exec(M139)).at(-1).rows[0], final);
  assert.equal((await db.query(`select has_table_privilege('authenticated', 'public.daily_check_claims', 'SELECT,INSERT,UPDATE,DELETE') as p`)).rows[0].p, false);
  assert.equal((await db.query(`select has_function_privilege('authenticated', 'public.finish_daily_check(text, date, text, text)', 'EXECUTE') as p`)).rows[0].p, false);
  assert.equal((await db.query(`select has_function_privilege('anon', 'public.finish_daily_check(text, date, text, text)', 'EXECUTE') as p`)).rows[0].p, false);

  const D = '2026-11-27';
  // first claim wins; a second run for the same day does not, and is told who holds it
  assert.equal((await claim('t_check', D, 'run-a')).claimed, true);
  let second = await claim('t_check', D, 'run-b');
  assert.equal(second.claimed, false);
  assert.equal(second.holder_status, 'running');
  assert.equal(second.holder_run_id, 'run-a');
  // another check, or another day, is a separate claim
  assert.equal((await claim('t_other', D, 'run-b')).claimed, true);
  assert.equal((await claim('t_check', '2026-11-28', 'run-b')).claimed, true);
  // only the holder can finish it
  assert.equal(await finish('t_check', D, 'run-b', 'done'), false);
  assert.equal(await finish('t_check', D, 'run-a', 'done'), true);
  assert.equal(await finish('t_check', D, 'run-a', 'failed'), false, 'a finished claim is not finished again');
  second = await claim('t_check', D, 'run-c');
  assert.deepEqual([second.claimed, second.holder_status, second.holder_run_id], [false, 'done', 'run-a']);
  await assert.rejects(finish('t_check', D, 'run-a', 'running'), /status must be done or failed/);
  await assert.rejects(claim(null, D, 'run-a'), /required/);

  // a failed claim is taken over by the next run
  assert.equal((await claim('t_fail', D, 'run-a')).claimed, true);
  assert.equal(await finish('t_fail', D, 'run-a', 'failed'), true);
  assert.equal((await claim('t_fail', D, 'run-b')).claimed, true);
  assert.deepEqual(await row('t_fail', D), { status: 'running', run_id: 'run-b', attempts: 2 });

  // a running claim is safe for 30 minutes, then taken over; the old holder can no longer finish it
  assert.equal((await claim('t_stale', D, 'run-a')).claimed, true);
  await db.query(`update public.daily_check_claims set claimed_at = now() - interval '29 minutes' where check_name = 't_stale'`);
  assert.equal((await claim('t_stale', D, 'run-b')).claimed, false, 'a live run is not taken over');
  await db.query(`update public.daily_check_claims set claimed_at = now() - interval '31 minutes' where check_name = 't_stale'`);
  assert.equal((await claim('t_stale', D, 'run-b')).claimed, true, 'a stale run is');
  assert.equal(await finish('t_stale', D, 'run-a', 'done'), false, 'the crashed run cannot overwrite the new claim');
  assert.equal(await finish('t_stale', D, 'run-b', 'done'), true);

  // force takes any claim, done included
  assert.equal((await claim('t_check', D, 'run-f', true)).claimed, true);
  assert.deepEqual(await row('t_check', D), { status: 'running', run_id: 'run-f', attempts: 2 });

  // bad values are rejected by the table itself
  await assert.rejects(db.query(`insert into public.daily_check_claims(check_name, slot_date, status, run_id) values ('Bad Name', '${D}', 'done', 'x')`));
  await assert.rejects(db.query(`insert into public.daily_check_claims(check_name, slot_date, status, run_id) values ('ok', '${D}', 'maybe', 'x')`));
  await db.exec(`delete from public.daily_check_claims`);
}

// ------------------------------------------------- 2. the checks, end to end
// A supabase-js stand-in over PGlite: the two RPCs and the pipeline_skips insert the claim module uses
const pgClient = {
  rpc: async (fn, a) => {
    try {
      // PostgREST returns a set-returning function's rows as an array
      if (fn === 'claim_daily_check') return { data: [await claim(a.p_check_name, a.p_slot_date, a.p_run_id, a.p_force)], error: null };
      if (fn === 'finish_daily_check') return { data: await finish(a.p_check_name, a.p_slot_date, a.p_run_id, a.p_status), error: null };
      throw new Error(`unexpected rpc ${fn}`);
    } catch (err) {
      return { data: null, error: { code: err.code, message: err.message } };
    }
  },
  from: (table) => ({
    insert: async (r) => {
      await db.query(`insert into public.${table}(pipeline, reason, entity_type, entity_id, metadata) values ($1, $2, $3, $4, $5)`,
        [r.pipeline, r.reason, r.entity_type, r.entity_id, r.metadata]);
      return { error: null };
    },
  }),
};
// The same, for a database where migration 139 is not applied yet (PostgREST: function not found)
const noMigration = { ...pgClient, rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.claim_daily_check' } }) };

const DAILY = Date.parse('2026-11-27T13:23:00Z');
const SLOT = '2026-11-27';
const HOOK = 'https://d.test/h';
const base = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', DISCORD_WEBHOOK_URL: HOOK };
const netlify = (runId) => ({ ...base, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: '1' });
const outputs = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-claims-'));
const fallback = (runId) => ({ ...base, GITHUB_EVENT_NAME: 'schedule', DAILY_CHECK_FALLBACK: '1', GITHUB_RUN_ID: runId, GITHUB_OUTPUT: path.join(outputs, `${runId}.txt`) });
const stepOutput = (env) => (fs.existsSync(env.GITHUB_OUTPUT) ? fs.readFileSync(env.GITHUB_OUTPUT, 'utf8') : '');

// Fake PostgREST + Discord for the Stories digest: one flagged story in the slot, Discord up or down
let discordUp = true;
const posts = [];
const storiesFetch = async (url, init = {}) => {
  if (url === HOOK) {
    if (!discordUp) return new Response('down', { status: 500 });
    posts.push(JSON.parse(init.body).embeds[0]);
    return new Response(null, { status: 204 });
  }
  const rows = [{ id: 1, story_id: 17301, notes: 'wrong vote count', created_at: '2026-11-27T03:00:00Z', stories: { primary_headline: 'Budget bill' } }];
  return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/1' } });
};
const logs = [];
const stories = (env, { now = DAILY, supabase = pgClient } = {}) =>
  runNeedsReviewAlert({ env, argv: ['--domain', 'stories'], fetchImpl: storiesFetch, log: (l) => logs.push(l), now, supabase });
const reset = async () => { await db.exec('delete from public.daily_check_claims; delete from public.pipeline_skips;'); posts.length = 0; logs.length = 0; discordUp = true; };

out('2. two runs for the same day post once');
{
  await reset();
  assert.deepEqual(await stories(netlify('100')), { flagged: 1, due: true, posted: true });
  assert.deepEqual(await stories(netlify('101')), { flagged: 0, due: false, posted: false }, 'a manual click without force');
  assert.equal(posts.length, 1);
  assert.deepEqual(await row('stories_review', SLOT), { status: 'done', run_id: '100-1', attempts: 1 });
  const skips = await skipRows();
  assert.equal(skips.length, 1);
  const { metadata, ...skip } = skips[0];
  assert.deepEqual(skip, {
    pipeline: 'daily_health_check', reason: 'already_claimed', entity_type: 'daily_check', entity_id: `stories_review:${SLOT}`,
  });
  assert.equal(metadata.holder_run_id, '100-1');
  assert.equal(metadata.holder_status, 'done');
  assert.equal(metadata.run_id, '101-1');
  assert.ok(logs.some((l) => /skipped, run 100-1 already did this check.*force/.test(l)));
  // a manual run before 12:00 UTC the next day reports the same slot, so it claims the same day
  assert.equal(claimSlotDate(Date.parse('2026-11-28T10:00:00Z')), SLOT);
  assert.deepEqual(await stories(netlify('102'), { now: Date.parse('2026-11-28T10:00:00Z') }), { flagged: 0, due: false, posted: false });
  assert.equal(posts.length, 1);
}

out('3. fallback first, Netlify late (Codex finding 3 on ADO-639)');
{
  await reset();
  const fb = fallback('200');
  assert.equal((await stories(fb)).posted, true);
  assert.equal(stepOutput(fb), 'fallback_ran=true\n', 'the fallback tells the workflow to ping "ran from the backup run"');
  assert.equal((await stories(netlify('201'), { now: Date.parse('2026-11-27T15:10:00Z') })).posted, false);
  assert.equal(posts.length, 1);
  assert.equal((await skipRows()).length, 1);
  // a second scheduled fallback run the same day: no digest, and no second "ran from the backup run" ping
  const fb2 = fallback('202');
  assert.equal((await stories(fb2, { now: Date.parse('2026-11-27T20:41:00Z') })).posted, false);
  assert.equal(stepOutput(fb2), '');
  assert.equal(posts.length, 1);
}

out('4. overlapping runs (two fallback runs, and a fallback next to a Netlify run still in progress)');
{
  await reset();
  const [fa, fb] = [fallback('300'), fallback('301')];
  const results = await Promise.all([stories(fa), stories(fb)]);
  assert.equal(results.filter((r) => r.posted).length, 1, 'exactly one of two overlapping runs posts');
  assert.equal(posts.length, 1);
  assert.equal([stepOutput(fa), stepOutput(fb)].filter(Boolean).length, 1, 'and only that one pings "ran from the backup run"');
  assert.equal((await skipRows()).length, 1);

  await reset();
  const mixed = await Promise.all([stories(netlify('310')), stories(fallback('311')), stories(netlify('312'))]);
  assert.equal(mixed.filter((r) => r.posted).length, 1);
  assert.equal(posts.length, 1);
  assert.equal((await skipRows()).length, 2);
}

out('5. a failed run or a stale claim does not block the day');
{
  await reset();
  discordUp = false;
  assert.deepEqual(await stories(netlify('400')), { flagged: 1, due: true, posted: false });
  assert.equal((await row('stories_review', SLOT)).status, 'failed', 'Discord did not accept the digest: the day stays open');
  discordUp = true;
  assert.equal((await stories(fallback('401'))).posted, true, 'the next run posts it');
  assert.deepEqual(await row('stories_review', SLOT), { status: 'done', run_id: '401-1', attempts: 2 });

  // the query itself fails: the claim is marked failed and the error still reaches runCli
  await reset();
  const broken = async (url, init) => (url === HOOK ? storiesFetch(url, init) : new Response('boom', { status: 500 }));
  await assert.rejects(runNeedsReviewAlert({ env: netlify('410'), argv: ['--domain', 'stories'], fetchImpl: broken, log: () => {}, now: DAILY, supabase: pgClient }), /query failed: 500/);
  assert.equal((await row('stories_review', SLOT)).status, 'failed');
  assert.equal((await stories(netlify('411'))).posted, true);

  // a run that died while holding the claim: blocked for 30 minutes, then taken over
  await reset();
  await claim('stories_review', SLOT, 'crashed-run');
  assert.equal((await stories(fallback('420'))).posted, false, 'a claim under 30 minutes old may still be a live run');
  assert.ok(logs.some((l) => /run crashed-run is doing this check right now/.test(l)));
  await db.query(`update public.daily_check_claims set claimed_at = now() - interval '31 minutes'`);
  assert.equal((await stories(fallback('421'))).posted, true);
  assert.equal(posts.length, 1);
}

out('6. force checks again');
{
  await reset();
  assert.equal((await stories(netlify('500'))).posted, true);
  assert.equal((await stories({ ...netlify('501'), DAILY_CHECK_FORCE: '1' })).posted, true, 'a manual run with force posts again');
  assert.equal(posts.length, 2);
  assert.deepEqual(await row('stories_review', SLOT), { status: 'done', run_id: '501-1', attempts: 2 });
  assert.equal((await skipRows()).length, 0);
  // and a later automatic run that day still skips
  assert.equal((await stories(fallback('502'))).posted, false);
}

out('7. migration 139 not applied: the check still runs (fails open) and warns');
{
  await reset();
  assert.equal((await stories(netlify('600'), { supabase: noMigration })).posted, true);
  assert.equal((await stories(netlify('601'), { supabase: noMigration })).posted, true, 'without the table nothing can stop a repeat');
  assert.ok(logs.some((l) => /^::warning::\[daily-claim\] stories_review 2026-11-27: could not claim the day \(PGRST202 .*migration 139/.test(l)));
  // the claim cannot be read for any other reason (database down): same
  const down = { ...pgClient, rpc: async () => { throw new TypeError('fetch failed'); } };
  assert.equal((await stories(netlify('602'), { supabase: down })).posted, true);
  // a fallback run that could not read the claim does not claim to be the backup that did the day
  const fb = fallback('603');
  assert.equal((await stories(fb, { supabase: noMigration })).posted, true);
  assert.equal(stepOutput(fb), '', 'no "ran from the backup run" ping without a claim');
}

out('8. ingest health uses its own claim');
{
  await reset();
  const healthyFetch = async (url) => {
    const u = new URL(url);
    if (u.searchParams.has('last_item_published_at')) return Response.json([]); // no stale feed
    if (u.pathname.endsWith('/feed_registry')) return Response.json([{ source_name: 'Reason', failure_count: 0 }]);
    if (u.searchParams.get('or')) return Response.json([]);
    return Response.json([{ id: 'a1' }]);
  };
  const ingest = (env) => runIngestHealth({ env, fetchImpl: healthyFetch, log: () => {}, now: DAILY, supabase: pgClient });
  assert.equal((await ingest(netlify('700'))).state, 'healthy');
  assert.equal((await ingest(fallback('701'))).state, 'already_ran');
  assert.equal((await ingest({ ...fallback('702'), INGEST_HEALTH_FORCE: '1' })).state, 'healthy', 'its own override forces too');
  assert.deepEqual(await row('ingest_health', SLOT), { status: 'done', run_id: '702-1', attempts: 2 });
  assert.equal(await row('stories_review', SLOT), undefined, 'the Stories digest has not run today');
  assert.deepEqual((await skipRows()).map((s) => s.entity_id), [`ingest_health:${SLOT}`]);

  // Codex P2: every PROD read fails (503) while Discord works. The "could not read" message goes out,
  // but the check did not happen: the day stays open, and the next run after Supabase recovers checks.
  await reset();
  const hooked = [];
  const supabaseDown = async (url, init) => {
    if (url === HOOK) { hooked.push(JSON.parse(init.body).embeds[0]); return new Response(null, { status: 204 }); }
    return new Response('upstream unavailable', { status: 503 });
  };
  const down = await runIngestHealth({ env: netlify('710'), fetchImpl: supabaseDown, log: () => {}, now: DAILY, supabase: pgClient });
  assert.equal(down.state, 'problems');
  assert.equal(down.posted, true);
  assert.ok(down.findings.readErrors.length >= 3, `reads failed: ${down.findings.readErrors.join('; ')}`);
  assert.match(hooked[0].description, /Could not read/);
  assert.equal((await row('ingest_health', SLOT)).status, 'failed', 'failed reads are not a finished check');
  assert.equal((await ingest(fallback('711'))).state, 'healthy', 'the next run takes the day over');
  assert.deepEqual(await row('ingest_health', SLOT), { status: 'done', run_id: '711-1', attempts: 2 });
}

// run ids: one per GitHub run attempt; a local run gets its own
assert.equal(claimRunId({ GITHUB_RUN_ID: '9', GITHUB_RUN_ATTEMPT: '2' }), '9-2');
assert.match(claimRunId({}, 123), /^local-\d+-123$/);

fs.rmSync(outputs, { recursive: true, force: true });
await db.close();
out('daily-check-claims-pglite: all tests passed');
