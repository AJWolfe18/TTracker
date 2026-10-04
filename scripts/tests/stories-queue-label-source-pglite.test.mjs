// Runs migration 124 (ADO-594 S2: stories_needing_enrichment returns action_label_source) on
// PGlite (Postgres 17) on top of migrations 117 and 123 and a minimal copy of the schema, then checks:
//   the new column is returned last with the right value (human / backfill / agent / NULL), every
//   other column is identical to the 117 RPC for the same data (never_enriched, new_articles,
//   merged, retry_failed; unchanged, legacy GPT and closed stories still excluded; p_limit and
//   pool_size unchanged), the grants are unchanged, and a re-run is idempotent.
// Not part of qa:smoke: @electric-sql/pglite is not a declared dependency, so the test SKIPS
// (exit 0) when it is missing. Run: node scripts/tests/stories-queue-label-source-pglite.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = (s) => process.stdout.write(`${s}\n`);

let PGlite;
try {
  ({ PGlite } = await import(pathToFileURL(path.join(repo, 'node_modules/@electric-sql/pglite/dist/index.js')).href));
} catch {
  out('stories-queue-label-source-pglite: SKIP (@electric-sql/pglite not installed)');
  process.exit(0);
}

const mig = (f) => fs.readFileSync(path.join(repo, 'migrations', f), 'utf8');
const MIG117 = mig('117_stories_needing_enrichment.sql');
const MIG123 = mig('123_story_action_labels.sql');
const MIG124 = mig('124_stories_needing_enrichment_label_source.sql');

const SCHEMA = String.raw`
create role anon; create role authenticated; create role service_role;
create table public.events(id bigserial primary key, slug text, name text, publish_state text);
create table public.stories(
  id bigint primary key, status text, primary_headline text, summary_neutral text,
  first_seen_at timestamptz default now(), alarm_level smallint, severity text,
  main_line boolean not null default false,
  last_enriched_at timestamptz, enrichment_failure_count integer, enrichment_meta jsonb);
create table public.story_event(story_id bigint primary key references public.stories(id),
  event_id bigint references public.events(id));
create table public.tracker_pin(source text, entity_id text, pin text, primary key(source, entity_id));
create table public.article_story(story_id bigint, article_id text, matched_at timestamptz,
  primary key(story_id, article_id));
create table public.story_merge_audit(id bigserial primary key, survivor_id bigint,
  merged_at timestamptz, unmerged_at timestamptz, loser_article_ids text[]);
create view public.v_tracker_stories with (security_invoker = true) as
  select s.id, s.primary_headline, s.first_seen_at, s.alarm_level, s.severity,
         e.id as front_id, e.name as front_name, e.slug as front_slug, p.pin as tracker_pin, s.main_line
    from public.stories s
    left join public.story_event se on se.story_id = s.id
    left join public.events e on e.id = se.event_id and e.publish_state = 'published'
    left join public.tracker_pin p on p.source = 'stories' and p.entity_id = s.id::text
   where s.status = 'active' and s.summary_neutral is not null;
`;

// Timestamps relative to now() so the 12-hour cooldown is meaningful.
const DATA = String.raw`
insert into public.stories(id, status, primary_headline, summary_neutral, last_enriched_at, enrichment_failure_count, enrichment_meta) values
  -- 1 never enriched
  (1, 'active', 'never enriched', null, null, 0, null),
  -- 2 grew since the watermark (new_articles); will be human-labeled
  (2, 'active', 'grew', 'sum', now() - interval '2 days', 0,
     jsonb_build_object('source', 'claude-agent', 'evidence_as_of', (now() - interval '3 days')::text)),
  -- 3 a Judge merge after the watermark (merged); backfill label
  (3, 'active', 'merged', 'sum', now() - interval '2 days', 0,
     jsonb_build_object('source', 'claude-agent', 'evidence_as_of', (now() - interval '3 days')::text)),
  -- 4 failed attempt, nothing new, under the cap (retry_failed); agent label
  (4, 'active', 'failed once', null, now() - interval '2 days', 1,
     jsonb_build_object('source', 'claude-agent', 'last_attempt_status', 'failed',
                        'evidence_as_of', (now() - interval '5 days')::text,
                        'attempt_evidence_as_of', (now() - interval '5 days')::text)),
  -- 5 unchanged since a successful enrichment: excluded
  (5, 'active', 'unchanged', 'sum', now() - interval '2 days', 0,
     jsonb_build_object('source', 'claude-agent', 'evidence_as_of', (now() - interval '3 days')::text)),
  -- 6 legacy GPT output with a new article: excluded
  (6, 'active', 'legacy gpt', 'sum', now() - interval '20 days', 0, '{"model": "gpt-4o-mini"}'::jsonb),
  -- 7 closed: excluded
  (7, 'closed', 'closed', null, null, 0, null),
  -- 8 grew, inside the cooldown: excluded
  (8, 'active', 'cooldown', 'sum', now() - interval '1 hour', 0,
     jsonb_build_object('source', 'claude-agent', 'evidence_as_of', (now() - interval '3 days')::text));
insert into public.article_story(story_id, article_id, matched_at) values
  (1, 'a1', now() - interval '1 hour'),
  (2, 'a2old', now() - interval '4 days'), (2, 'a2new', now() - interval '1 day'),
  (3, 'a3', now() - interval '4 days'), (3, 'a3loser', now() - interval '5 days'),
  (4, 'a4', now() - interval '5 days'),
  (5, 'a5', now() - interval '3 days'),
  (6, 'a6', now() - interval '1 day'),
  (7, 'a7', now() - interval '1 day'),
  (8, 'a8', now() - interval '30 minutes');
insert into public.story_merge_audit(survivor_id, merged_at, unmerged_at, loser_article_ids) values
  (3, now() - interval '1 day', null, array['a3loser']);
`;

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) out(`  ok   ${name}`);
  else { failures++; out(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`); }
};
// timestamptz / arrays / jsonb come back as Date / Array / object: compare as JSON
const norm = (rows) => JSON.stringify(rows);

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(MIG117);
await db.exec(MIG123);
await db.exec(DATA);
// labels: 2 human (through the one door), 3 backfill, 4 agent, 1 none
await db.query("select * from public.set_story_action_label(2, 'did', 'trump')");
await db.exec("update public.stories set action_label='coverage', action_actor='other', action_label_source='backfill' where id=3");
await db.exec("update public.stories set action_label='said', action_actor='trump' where id=4");

out('stories-queue-label-source-pglite');

const rpc = async (args = '40, 12, 3') => (await db.query(`select * from public.stories_needing_enrichment(${args}) order by id`)).rows;
const before = await rpc();
const beforeLimited = (await db.query('select * from public.stories_needing_enrichment(2, 12, 3)')).rows;

await db.exec(MIG124);
const after = await rpc();
const afterLimited = (await db.query('select * from public.stories_needing_enrichment(2, 12, 3)')).rows;

// 1. Shape: the new column is appended last; all 117 columns still there in order
const cols117 = Object.keys(before[0] ?? {});
const cols124 = Object.keys(after[0] ?? {});
check('117 columns unchanged and in order', norm(cols124.slice(0, -1)) === norm(cols117), cols124.join(','));
check('action_label_source is the last column', cols124.at(-1) === 'action_label_source', cols124.join(','));

// 2. Same pool and the same values for every 117 column
check('same candidates (1,2,3,4)', norm(after.map((r) => r.id)) === norm([1, 2, 3, 4]), norm(after.map((r) => r.id)));
const strip = (rows) => rows.map(({ action_label_source, ...rest }) => rest);
check('every 117 column identical to 117 output', norm(strip(after)) === norm(before));
check('p_limit / pool_size / order unchanged', norm(strip(afterLimited)) === norm(beforeLimited) && afterLimited[0]?.pool_size === 4,
  norm(afterLimited.map((r) => [r.id, r.pool_size])));
const reasons = Object.fromEntries(after.map((r) => [r.id, r.reason]));
check('reasons still never_enriched / new_articles / merged / retry_failed',
  reasons[1] === 'never_enriched' && reasons[2] === 'new_articles' && reasons[3] === 'merged' && reasons[4] === 'retry_failed',
  norm(reasons));
const ids3 = after.find((r) => r.id === 3)?.new_article_ids;
check('merge evidence still listed in new_article_ids', norm(ids3) === norm(['a3loser']), norm(ids3));

// 3. The new column carries the stored source
const src = Object.fromEntries(after.map((r) => [r.id, r.action_label_source]));
check('human lock visible', src[2] === 'human', norm(src));
check('backfill and agent sources returned', src[3] === 'backfill' && src[4] === 'agent', norm(src));
check('unlabeled story returns NULL', src[1] === null, norm(src));

// 4. Grants unchanged: service_role only
const priv = async (role) => (await db.query(
  `select has_function_privilege('${role}', 'public.stories_needing_enrichment(integer,integer,integer)', 'execute') as g`)).rows[0].g;
check('anon cannot execute', (await priv('anon')) === false);
check('authenticated cannot execute', (await priv('authenticated')) === false);
check('service_role can execute', (await priv('service_role')) === true);

// 5. Idempotent re-run, one function, final check query
await db.exec(MIG124);
check('re-run returns the same rows', norm(await rpc()) === norm(after));
const n = (await db.query("select count(*)::int as n from pg_proc where proname = 'stories_needing_enrichment'")).rows[0].n;
check('one function after re-run', n === 1, String(n));
const last = (await db.query(MIG124.slice(MIG124.lastIndexOf('SELECT\n')))).rows[0];
check('final check: first column rpc_has_label_source = 1', Object.keys(last)[0] === 'rpc_has_label_source' && last.rpc_has_label_source === 1
  && last.rpc_versions === 1 && last.anon_can_execute === false, norm(last));

await db.close();
out(failures ? `stories-queue-label-source-pglite: ${failures} FAILED` : 'stories-queue-label-source-pglite: all passed');
process.exit(failures ? 1 : 0);
