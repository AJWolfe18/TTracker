// Runs migration 127 (ADO-592: one front assignment agent for every front) on PGlite (Postgres 17)
// after 116 (the election-only RPC) and 123 (action labels), against a minimal copy of the tracker
// schema, then checks: the multi-front pool, the coverage filter (ADO-594 S7), unlabeled stories
// staying in, members excluded, unpublished fronts / fronts without a pattern or definition excluded,
// old per-front declines hiding a story from that front only, a new "fits no front" decline hiding it
// from the fronts that run judged (a later front still sees it) until the story changes, matched_fronts order, the election seed, grants, the old RPC still working, and an
// idempotent re-run that keeps an edited definition.
// Not part of qa:smoke: @electric-sql/pglite is not a declared dependency, so the test SKIPS
// (exit 0) when it is missing. Run: node scripts/tests/all-fronts-agent-sql-pglite.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = (s) => process.stdout.write(`${s}\n`);

let PGlite;
try {
  ({ PGlite } = await import(pathToFileURL(path.join(repo, 'node_modules/@electric-sql/pglite/dist/index.js')).href));
} catch {
  out('all-fronts-agent-sql-pglite: SKIP (@electric-sql/pglite not installed)');
  process.exit(0);
}

const read = (f) => fs.readFileSync(path.join(repo, 'migrations', f), 'utf8');
const M116 = read('116_front_agent_candidates.sql');
const M123 = read('123_story_action_labels.sql');
const M127 = read('127_all_fronts_agent.sql');

const SCHEMA = String.raw`
create role anon; create role authenticated; create role service_role;
create table public.events(id bigint primary key, slug text unique, name text, publish_state text,
  sweep_priority smallint not null default 100);
create table public.stories(
  id bigint primary key, status text, primary_headline text, summary_neutral text,
  first_seen_at timestamptz default now(), last_updated_at timestamptz,
  alarm_level smallint, severity text, category text, main_line boolean not null default false);
create table public.story_event(story_id bigint primary key references public.stories(id),
  event_id bigint references public.events(id), event_update_id bigint, assigned_by text,
  confidence numeric, assigned_at timestamptz default now(), reassigned_at timestamptz,
  reassigned_from_event_id bigint);
create table public.tracker_pin(source text, entity_id text, pin text, primary key(source, entity_id));
create table public.pipeline_skips(id bigserial primary key, pipeline text, reason text, entity_type text,
  entity_id text, metadata jsonb, created_at timestamptz not null default now());
`;

// Fronts: election (published, pattern; definition from the 127 seed), ice (published, pattern,
// definition), hegseth (published, pattern, definition, priority 90), courts (published, NO pattern),
// crypto (DRAFT, pattern, definition), rfk (published, pattern, NO definition).
const DATA = String.raw`
insert into public.events(id, slug, name, publish_state, sweep_priority) values
  (14, 'election-suppression', 'Election Suppression', 'published', 50),
  (18, 'ice-deportations', 'ICE & Deportations', 'published', 72),
  (15, 'hegseth-pentagon', 'Hegseth''s Pentagon', 'published', 90),
  (12, 'the-courts', 'The Courts', 'published', 70),
  (9,  'trump-crypto', 'Trump Crypto', 'draft', 30),
  (17, 'rfk-hhs', 'RFK Jr.''s HHS', 'published', 85);
insert into public.stories(id, status, primary_headline, summary_neutral, first_seen_at, last_updated_at, alarm_level, category) values
  (1,  'active', 'County purges voters before the midterms', 'sum', now() - interval '10 day', now() - interval '10 day', 3, 'democracy_elections'),
  (2,  'active', 'ICE raids a meatpacking plant', 'sum', now() - interval '9 day', now() - interval '9 day', 4, 'immigration'),
  (3,  'active', 'Op-ed: what ICE means for voters', 'sum', now() - interval '8 day', now() - interval '8 day', 2, 'immigration'),
  (4,  'active', 'Hegseth fires another admiral', 'ice agents nearby', now() - interval '7 day', now() - interval '7 day', 4, 'military'),
  (5,  'active', 'Judge blocks the order', 'sum', now() - interval '6 day', now() - interval '6 day', 3, 'courts'),
  (6,  'active', 'Bitcoin reserve memecoin launch', 'sum', now() - interval '5 day', now() - interval '5 day', 3, 'corruption_scandals'),
  (7,  'active', 'CDC vaccine panel purged', 'sum', now() - interval '4 day', now() - interval '4 day', 4, 'health'),
  (8,  'active', 'ICE detention deaths rise', 'sum', now() - interval '3 day', now() - interval '3 day', 4, 'immigration'),
  (9,  'active', 'Voters fear ICE at polling places', 'sum', now() - interval '2 day', now() - interval '2 day', 4, 'democracy_elections'),
  (10, 'active', 'Ballots and deportation flights', 'sum', now() - interval '1 day', now() - interval '1 day', 3, 'immigration'),
  (11, 'closed', 'ICE raid in Chicago', 'sum', now() - interval '20 day', now() - interval '20 day', 3, 'immigration'),
  (12, 'active', 'ICE raid not yet enriched', null, now() - interval '1 hour', now() - interval '1 hour', null, null),
  (13, 'active', 'Voter roll lawsuit filed', 'sum', now() - interval '12 day', now() - interval '12 day', 3, 'democracy_elections');
-- 4 is a hegseth member already (excluded)
insert into public.story_event(story_id, event_id, assigned_by) values (4, 15, 'sweep');
-- 3 is labeled coverage (excluded); 2 is did; 8 said; the rest unlabeled (fail open)
update public.stories set action_label='coverage', action_actor='other', action_label_source='agent' where id=3;
update public.stories set action_label='did', action_actor='administration', action_label_source='agent' where id=2;
update public.stories set action_label='said', action_actor='trump', action_label_source='agent' where id=8;
-- old ADO-582 election-only declines: 9 also matches ICE, 13 matches election only
insert into public.pipeline_skips(pipeline, reason, entity_type, entity_id, metadata) values
  ('front_assignment', 'agent_declined', 'story', '9',  '{"front": "election-suppression"}'),
  ('front_assignment', 'agent_declined', 'story', '13', '{"front": "election-suppression"}');
`;

const PATTERNS = String.raw`
update public.events set agent_pattern = '\m(voters?|voting|ballots?|polling (place|places))\M' where slug = 'election-suppression';
update public.events set agent_pattern = '\m(ice|deport\w*|detention)\M' where slug = 'ice-deportations';
update public.events set agent_pattern = '\m(hegseth|admirals?)\M' where slug = 'hegseth-pentagon';
update public.events set agent_pattern = '\m(bitcoin|memecoin)\M' where slug = 'trump-crypto';
update public.events set agent_pattern = '\m(cdc|vaccine)\M' where slug = 'rfk-hhs';
update public.events set agent_definition = 'ICE definition' where slug = 'ice-deportations';
update public.events set agent_definition = 'Hegseth definition' where slug = 'hegseth-pentagon';
update public.events set agent_definition = 'Crypto definition' where slug = 'trump-crypto';
update public.events set agent_definition = '   ' where slug = 'rfk-hhs';
`;

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) out(`  ok   ${name}`);
  else { failures++; out(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`); }
};

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(M116);
await db.exec(M123);
await db.exec(DATA);
await db.exec(M127);
await db.exec(PATTERNS);

const pool = async (limit = 25) => (await db.query('select * from public.front_agent_candidates_all($1)', [limit])).rows;
const ids = (rows) => rows.map((r) => Number(r.story_id));
const byId = (rows, id) => rows.find((r) => Number(r.story_id) === id);

out('all-fronts-agent-sql-pglite');

// 1. The election seed carries the prompt-v1 rubric
const seed = (await db.query("select agent_definition from public.events where slug = 'election-suppression'")).rows[0].agent_definition;
check('election definition seeded', typeof seed === 'string' && seed.startsWith('The front is "**fronts they are screwing us on**"'));
check('election seed keeps the calibration table', seed.includes('Missouri court allows Trump-backed congressional districts to take effect') && seed.includes('City council vote on downtown zoning ballot measure'));

// 2. The multi-front pool
let rows = await pool();
// expected: 10 (election+ice), 9 (ice only: old election decline), 8 (ice), 2 (ice), 1 (election)
check('pool is the multi-front set, newest first', JSON.stringify(ids(rows)) === JSON.stringify([10, 9, 8, 2, 1]), JSON.stringify(ids(rows)));
check('pool_size on every row', rows.every((r) => r.pool_size === 5), JSON.stringify(rows.map((r) => r.pool_size)));
check('coverage story excluded (3)', !byId(rows, 3));
check('member excluded (4)', !byId(rows, 4));
check('front without a pattern excluded (5, the-courts)', !byId(rows, 5));
check('draft front excluded (6, trump-crypto)', !byId(rows, 6));
check('front with a blank definition excluded (7, rfk-hhs)', !byId(rows, 7));
check('closed and unenriched stories excluded (11, 12)', !byId(rows, 11) && !byId(rows, 12));
check('unlabeled story stays in (1)', byId(rows, 1)?.action_label === null);
check('labels come through as hints', byId(rows, 2)?.action_label === 'did' && byId(rows, 2)?.action_actor === 'administration' && byId(rows, 8)?.action_label === 'said');
check('matched_fronts lowest sweep_priority first', JSON.stringify(byId(rows, 10)?.matched_fronts) === JSON.stringify(['election-suppression', 'ice-deportations']), JSON.stringify(byId(rows, 10)?.matched_fronts));
check('old election-only decline does not hide a story from ICE (9)', JSON.stringify(byId(rows, 9)?.matched_fronts) === JSON.stringify(['ice-deportations']), JSON.stringify(byId(rows, 9)));
check('old election-only decline still hides an election-only story (13)', !byId(rows, 13));
check('limit pages the pool', JSON.stringify(ids(await pool(2))) === JSON.stringify([10, 9]));
check('null limit falls back to 25', (await db.query('select count(*)::int as n from public.front_agent_candidates_all(null)')).rows[0].n === 5);

// 3. A "fits no front" decline hides the story from the fronts that run judged, until it changes
const JUDGED = '["election-suppression", "ice-deportations", "hegseth-pentagon"]';
await db.exec(`insert into public.pipeline_skips(pipeline, reason, entity_type, entity_id, metadata) values
  ('front_assignment', 'agent_declined', 'story', '10', '{"front": "none", "run_id": "r1", "judged_fronts": ${JUDGED}}')`);
rows = await pool();
check('fits-no-front decline hides the story (10)', !byId(rows, 10) && rows.length === 4, JSON.stringify(ids(rows)));
// a decline from a run when only election had a definition: ICE has not judged story 8 yet
await db.exec(`insert into public.pipeline_skips(pipeline, reason, entity_type, entity_id, metadata) values
  ('front_assignment', 'agent_declined', 'story', '8', '{"front": "none", "judged_fronts": ["election-suppression"]}'),
  ('front_assignment', 'agent_declined', 'story', '1', '{"front": "none", "judged_fronts": ["election-suppression"]}')`);
rows = await pool();
check('a front added after the decline still sees the story (8)', JSON.stringify(byId(rows, 8)?.matched_fronts) === JSON.stringify(['ice-deportations']), JSON.stringify(ids(rows)));
check('a decline judged against the only matching front hides it (1)', !byId(rows, 1));
await db.exec("update public.stories set last_updated_at = now() + interval '1 minute' where id = 10");
rows = await pool();
check('a story that changes after the decline comes back (10)', !!byId(rows, 10));
// a decline row from another pipeline or reason never hides anything
await db.exec(`insert into public.pipeline_skips(pipeline, reason, entity_type, entity_id, metadata) values
  ('front_assignment', 'api_error', 'story', '2', '{"front": "none", "judged_fronts": ["ice-deportations"]}'),
  ('rss_enrichment', 'agent_declined', 'story', '2', '{"front": "none", "judged_fronts": ["ice-deportations"]}')`);
check('only front_assignment/agent_declined rows count', !!byId(await pool(), 2));

// 4. Assigning removes the story; the old RPC still works for election
await db.exec("insert into public.story_event(story_id, event_id, assigned_by) values (2, 18, 'agent')");
check('an assigned story leaves the pool', !byId(await pool(), 2));
const old = (await db.query("select story_id from public.front_agent_candidates('election-suppression', 25)")).rows.map((r) => Number(r.story_id));
check('116 RPC still returns the election pool', old.includes(1) && old.includes(10) && !old.includes(9) && !old.includes(13), JSON.stringify(old));

// 5. Grants
const exec = async (role) => (await db.query(`select has_function_privilege('${role}', 'public.front_agent_candidates_all(integer)', 'execute') as g`)).rows[0].g;
check('service_role can call the RPC', await exec('service_role') === true);
check('anon and authenticated cannot', await exec('anon') === false && await exec('authenticated') === false);

// 6. Idempotent re-run keeps an edited definition and the pool
await db.exec("update public.events set agent_definition = 'edited by Josh' where slug = 'election-suppression'");
const before = ids(await pool());
await db.exec(M127);
const after = (await db.query("select agent_definition from public.events where slug = 'election-suppression'")).rows[0].agent_definition;
check('re-run does not overwrite an edited definition', after === 'edited by Josh', after);
check('re-run keeps the pool', JSON.stringify(ids(await pool())) === JSON.stringify(before));
const fns = (await db.query("select count(*)::int as n from pg_proc where proname = 'front_agent_candidates_all'")).rows[0].n;
check('re-run leaves one function', fns === 1, String(fns));

// 7. The final read-only check
const last = (await db.query(M127.slice(M127.search(/^SELECT\r?$/m)))).rows[0]; // CRLF-safe (autocrlf checkouts)
check('final check query first column is agent_fronts', Object.keys(last)[0] === 'agent_fronts', JSON.stringify(last));
check('final check counts the three agent fronts', Number(last.agent_fronts) === 3 && last.election_definition === true && Number(last.candidates_fn) === 1, JSON.stringify(last));

await db.close();
out(failures ? `all-fronts-agent-sql-pglite: ${failures} FAILED` : 'all-fronts-agent-sql-pglite: all passed');
process.exit(failures ? 1 : 0);
