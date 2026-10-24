// Runs migration 123 (action labels + lock) then 125 (ADO-594 S3: label backfill pool + writer)
// on PGlite (Postgres 17) against a minimal copy of the tracker schema, then checks:
//   the pool's shape, order, filters and limit clamp; record_action_labels writes only unlabeled
//   rows (never an agent or human label), logs every unwritten or uncertain row to pipeline_skips,
//   rejects bad input atomically; grants; idempotent re-run; the final check's first column.
// Not part of qa:smoke: @electric-sql/pglite is not a declared dependency, so the test SKIPS
// (exit 0) when it is missing. Run: node scripts/tests/label-backfill-sql-pglite.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PIPELINES, REASONS } from '../lib/skip-reasons.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = (s) => process.stdout.write(`${s}\n`);

let PGlite;
try {
  ({ PGlite } = await import(pathToFileURL(path.join(repo, 'node_modules/@electric-sql/pglite/dist/index.js')).href));
} catch {
  out('label-backfill-sql-pglite: SKIP (@electric-sql/pglite not installed)');
  process.exit(0);
}

const M123 = fs.readFileSync(path.join(repo, 'migrations/123_story_action_labels.sql'), 'utf8');
const M125 = fs.readFileSync(path.join(repo, 'migrations/125_label_backfill.sql'), 'utf8');

const SCHEMA = String.raw`
create role anon; create role authenticated; create role service_role;
create table public.events(id bigserial primary key, slug text, name text, publish_state text);
create table public.stories(
  id bigint primary key, status text, primary_headline text, summary_neutral text, primary_actor text,
  first_seen_at timestamptz default now(), last_updated_at timestamptz, alarm_level smallint, severity text,
  content text, centroid_embedding text, main_line boolean not null default false);
create table public.story_event(story_id bigint primary key references public.stories(id),
  event_id bigint references public.events(id));
create table public.tracker_pin(source text, entity_id text, pin text, primary key(source, entity_id));
create table public.pipeline_skips(id bigserial primary key, pipeline text not null, reason text not null,
  entity_type text, entity_id text, metadata jsonb, created_at timestamptz not null default now());
create view public.v_tracker_stories with (security_invoker = true) as
  select s.id, s.primary_headline, s.first_seen_at, s.alarm_level, s.severity,
         e.id as front_id, e.name as front_name, e.slug as front_slug, p.pin as tracker_pin, s.main_line
    from public.stories s
    left join public.story_event se on se.story_id = s.id
    left join public.events e on e.id = se.event_id and e.publish_state = 'published'
    left join public.tracker_pin p on p.source = 'stories' and p.entity_id = s.id::text
   where s.status = 'active' and s.summary_neutral is not null;
grant select on public.v_tracker_stories to anon;
-- 10-15: the pool, newest first; 13 and 14 share a first_seen_at (id desc breaks the tie).
insert into public.stories(id, status, primary_headline, summary_neutral, primary_actor, alarm_level, first_seen_at, last_updated_at, content) values
  (10, 'active', 'Oldest', 'sum', null, 2, '2026-09-01', '2026-09-01', 'BIG'),
  (11, 'active', 'DOJ charges agent', 'sum', 'DOJ', 4, '2026-09-02', '2026-09-02', 'BIG'),
  (12, 'active', 'Trump threatens Bombardier', 'sum', 'Donald Trump', 3, '2026-09-03', '2026-09-03', 'BIG'),
  (13, 'active', 'Tie low id', 'sum', null, 2, '2026-09-04', '2026-09-04', 'BIG'),
  (14, 'active', 'Tie high id', 'sum', null, 2, '2026-09-04', '2026-09-04', 'BIG'),
  (15, 'active', 'Newest', 'sum', null, 1, '2026-09-05', '2026-09-05', 'BIG'),
  (20, 'closed', 'Closed story', 'sum', null, 5, '2026-09-06', '2026-09-06', 'BIG'),
  (21, 'active', 'Not enriched yet', null, null, null, '2026-09-06', '2026-09-06', 'BIG'),
  (22, 'active', 'Agent labeled', 'sum', null, 4, '2026-09-06', '2026-09-06', 'BIG'),
  (23, 'active', 'Human labeled', 'sum', null, 4, '2026-09-06', '2026-09-06', 'BIG');
`;

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) out(`  ok   ${name}`);
  else { failures++; out(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`); }
};
// A rejection must come from the function's own checks, not from some unrelated error.
const rejectsOwn = async (fn) => { try { await fn(); return false; } catch (e) { return /^record_action_labels: /.test(e.message); } };

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(M123);
await db.exec(M125);
// Labels written before the backfill reaches them: an agent label, and a human label via the door.
await db.exec("update public.stories set action_label='did', action_actor='administration' where id=22");
await db.query("select * from public.set_story_action_label(23, 'said', 'trump')");

const pool = async (limit) => (await db.query(
  limit === undefined ? 'select * from public.label_backfill_candidates()' : 'select * from public.label_backfill_candidates($1)', limit === undefined ? [] : [limit])).rows;
const record = async (rows, runId = 'labels-test-1') => (await db.query(
  'select * from public.record_action_labels($1, $2::jsonb)', [runId, JSON.stringify(rows)])).rows;
const story = async (id) => (await db.query(
  'select action_label, action_actor, action_label_source, summary_neutral, alarm_level, last_updated_at, main_line from public.stories where id = $1', [id])).rows[0];
const skips = async () => (await db.query('select pipeline, reason, entity_id, metadata from public.pipeline_skips order by id')).rows;

out('label-backfill-sql-pglite');

// 1. Pool shape, order, filters
let p = await pool();
const cols = (await db.query("select * from public.label_backfill_candidates(1)")).fields.map((f) => f.name);
check('pool returns exactly the six small columns', cols.join(',') === 'id,primary_headline,summary_neutral,primary_actor,alarm_level,pool_size', cols.join(','));
check('pool never returns content or embeddings', !cols.some((c) => /content|embedding/.test(c)));
check('pool is newest first, id desc on ties', p.map((r) => r.id).join(',') === '15,14,13,12,11,10', p.map((r) => r.id).join(','));
check('pool skips closed, unenriched, agent- and human-labeled stories', !p.some((r) => [20, 21, 22, 23].includes(Number(r.id))));
check('pool_size is the whole pool on every row', p.every((r) => r.pool_size === 6), JSON.stringify(p.map((r) => r.pool_size)));
const p2 = await pool(2);
check('limit pages the pool; pool_size stays the total', p2.length === 2 && p2[0].pool_size === 6 && Number(p2[0].id) === 15, JSON.stringify(p2));
check('primary_actor and alarm_level come through', (await pool()).find((r) => Number(r.id) === 12)?.primary_actor === 'Donald Trump' && p.find((r) => Number(r.id) === 11)?.alarm_level === 4);
check('limit 0 and negative clamp to 1', (await pool(0)).length === 1 && (await pool(-5)).length === 1);
check('limit null means 50', (await db.query('select * from public.label_backfill_candidates(null)')).rows.length === 6);
await db.exec(`insert into public.stories(id, status, primary_headline, summary_neutral, first_seen_at)
  select g, 'active', 'bulk ' || g, 'sum', '2026-08-01'::timestamptz - make_interval(mins => g) from generate_series(1000, 1059) g`);
check('limit is capped at 50', (await pool(500)).length === 50);
check('pool_size counts past the cap', (await pool(500))[0].pool_size === 66);
await db.exec('delete from public.stories where id between 1000 and 1059');

// 2. Writes: unlabeled rows only, source backfill, nothing else touched
const before11 = await story(11);
let res = await record([
  { id: 11, action_label: 'did', action_actor: 'administration' },
  { id: 12, action_label: 'said', action_actor: 'trump', uncertain: false },
  { id: 13, action_label: 'coverage', action_actor: 'other', uncertain: true },
  { id: 22, action_label: 'coverage', action_actor: 'other' },
  { id: 23, action_label: 'coverage', action_actor: 'other' },
  { id: 999, action_label: 'did', action_actor: 'other' },
]);
const outcome = Object.fromEntries(res.map((r) => [Number(r.story_id), r.outcome]));
check('one result row per input, in order', res.map((r) => Number(r.story_id)).join(',') === '11,12,13,22,23,999', JSON.stringify(res));
check('unlabeled rows are written', outcome[11] === 'written' && outcome[12] === 'written' && outcome[13] === 'written', JSON.stringify(outcome));
let s = await story(11);
check('written row has the label and source backfill', s.action_label === 'did' && s.action_actor === 'administration' && s.action_label_source === 'backfill', JSON.stringify(s));
check('write touches no summary, alarm, watermark or main_line', s.summary_neutral === before11.summary_neutral && s.alarm_level === before11.alarm_level
  && String(s.last_updated_at) === String(before11.last_updated_at) && s.main_line === before11.main_line, JSON.stringify(s));
check('an agent label is never overwritten', outcome[22] === 'already_labeled' && (await story(22)).action_label === 'did' && (await story(22)).action_label_source === 'agent', JSON.stringify(await story(22)));
check('a human label is never overwritten', outcome[23] === 'already_labeled' && (await story(23)).action_label === 'said' && (await story(23)).action_label_source === 'human', JSON.stringify(await story(23)));
check('a missing story is reported', outcome[999] === 'not_found');
check('uncertain flag is echoed', res.find((r) => Number(r.story_id) === 13).uncertain === true && res.find((r) => Number(r.story_id) === 11).uncertain === false);

let sk = await skips();
const skipOf = (id, reason) => sk.find((x) => x.entity_id === String(id) && x.reason === reason);
check('every skip row uses the label_backfill pipeline', sk.length > 0 && sk.every((x) => x.pipeline === PIPELINES.LABEL_BACKFILL), JSON.stringify(sk));
check('already labeled rows leave a skip row with the existing source', skipOf(22, REASONS.ALREADY_LABELED)?.metadata?.existing_source === 'agent'
  && skipOf(23, REASONS.ALREADY_LABELED)?.metadata?.existing_source === 'human', JSON.stringify(sk));
check('missing story leaves a story_not_found row', !!skipOf(999, REASONS.STORY_NOT_FOUND));
check('uncertain label leaves a label_uncertain row with the label', skipOf(13, REASONS.LABEL_UNCERTAIN)?.metadata?.action_label === 'coverage'
  && skipOf(13, REASONS.LABEL_UNCERTAIN)?.metadata?.run_id === 'labels-test-1', JSON.stringify(sk));
check('written, certain rows leave no skip row', !sk.some((x) => ['11', '12'].includes(x.entity_id)));
check('exactly four skip rows', sk.length === 4, String(sk.length));

p = await pool();
check('recorded rows leave the pool', p.map((r) => Number(r.id)).join(',') === '15,14,10' && p[0].pool_size === 3, JSON.stringify(p.map((r) => r.id)));

// 3. Re-recording the same page is safe: nothing changes, each row reported
res = await record([{ id: 11, action_label: 'coverage', action_actor: 'other' }], 'labels-test-2');
check('re-record never overwrites a backfill label', res[0].outcome === 'already_labeled' && (await story(11)).action_label === 'did');

// 4. A later agent write still replaces a backfill label (re-enrichment wins)
await db.exec("update public.stories set action_label='said', action_actor='trump', action_label_source='agent' where id=12");
check('agent re-enrichment can replace a backfill label', (await story(12)).action_label_source === 'agent');

// 5. Validation: one bad row refuses the whole call, nothing written
const skipCount = (await skips()).length;
const good = { id: 14, action_label: 'did', action_actor: 'trump' };
const rejects = async (name, rows, runId) => check(`rejects ${name}`, await rejectsOwn(() => record(rows, runId)));
await rejects('a bad label', [good, { id: 15, action_label: 'maybe', action_actor: 'trump' }]);
await rejects('a bad actor', [good, { id: 15, action_label: 'did', action_actor: 'ceo' }]);
await rejects('a missing actor', [good, { id: 15, action_label: 'did' }]);
await rejects('a label that is not a string', [{ id: 15, action_label: ['did'], action_actor: 'trump' }]);
await rejects('a duplicate id', [good, good]);
await rejects('an id as a string', [{ ...good, id: '14' }]);
await rejects('a negative id', [{ ...good, id: -14 }]);
await rejects('a fractional id', [{ ...good, id: 14.5 }]);
await rejects('uncertain as a string', [{ ...good, uncertain: 'yes' }]);
await rejects('an empty page', []);
await rejects('51 rows', Array.from({ length: 51 }, (_, i) => ({ ...good, id: 5000 + i })));
await rejects('an unsafe run_id', [good], 'run;drop');
check('rejects a non-array', await rejectsOwn(() => db.query("select * from public.record_action_labels('r1', '{\"id\": 14}'::jsonb)")));
check('rejects a null page', await rejectsOwn(() => db.query("select * from public.record_action_labels('r1', null)")));
check('a rejected call wrote no label', (await story(14)).action_label === null && (await story(15)).action_label === null);
check('a rejected call wrote no skip row', (await skips()).length === skipCount);

// 5b. A human source with no label (only reachable with the admin flag): the UPDATE matches, the
// lock trigger restores the row, and the RPC must report it as not written.
await db.exec("begin; select set_config('app.label_admin', 'on', true); update public.stories set action_label_source='human' where id=10; commit;");
res = await record([{ id: 10, action_label: 'did', action_actor: 'other' }], 'labels-test-3');
s = await story(10);
check('a trigger-restored row is reported already_labeled, not written', res[0].outcome === 'already_labeled' && s.action_label === null && s.action_label_source === 'human', JSON.stringify({ res, s }));

// 6. Grants
for (const fn of ['public.label_backfill_candidates(integer)', 'public.record_action_labels(text,jsonb)']) {
  const g = (await db.query(`select has_function_privilege('anon', '${fn}', 'execute') as a,
    has_function_privilege('authenticated', '${fn}', 'execute') as u,
    has_function_privilege('service_role', '${fn}', 'execute') as s`)).rows[0];
  check(`${fn}: service_role only`, !g.a && !g.u && g.s, JSON.stringify(g));
}

// 7. Idempotent re-run keeps data; final check query
await db.exec(M123);
await db.exec(M125);
check('re-run keeps backfill labels', (await story(11)).action_label_source === 'backfill');
check('re-run keeps the pool', (await pool()).length === 3);
const last = (await db.query(M125.slice(M125.lastIndexOf('SELECT\n')))).rows[0];
check('final check query first column is backfill_pool', Object.keys(last)[0] === 'backfill_pool' && Number(last.backfill_pool) === 3, JSON.stringify(last));

await db.close();
out(failures ? `label-backfill-sql-pglite: ${failures} FAILED` : 'label-backfill-sql-pglite: all passed');
process.exit(failures ? 1 : 0);
