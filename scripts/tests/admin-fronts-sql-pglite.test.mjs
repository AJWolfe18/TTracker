// Runs migration 134 (ADO-547: admin Fronts tab RPCs) on PGlite (Postgres 17) against a minimal
// copy of the fronts schema (events, event_updates, stories, story_event with the migration-111
// keys), plus the real assign_fronts_sweep() lifted from migration 115, then checks:
//   assign: new / already on front / on another front (no move) / move (reassign columns, the
//           FIRST reassigned_from_event_id kept on a second move, event_update_id cleared) /
//           missing / merged / duplicate ids / unknown front / the 200 cap
//           a move needs the source front, and a story no longer on it is reported, not moved
//   unassign: removes from the named front only; sweep_would_refile agrees with what the real
//           sweep then does
//   set_update_stories: link + unlink as one replace, other fronts reported, missing update raises
//   check_front_pattern: valid -> NULL, broken -> message; preview: sweep + agent rules, counts
//   grants: anon/authenticated cannot execute, service_role can; idempotent re-run.
// Not part of qa:smoke: @electric-sql/pglite is not a declared dependency, so the test SKIPS
// (exit 0) when it is missing. Run: node scripts/tests/admin-fronts-sql-pglite.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = (s) => process.stdout.write(`${s}\n`);

let PGlite;
try {
  ({ PGlite } = await import(pathToFileURL(path.join(repo, 'node_modules/@electric-sql/pglite/dist/index.js')).href));
} catch {
  try {
    ({ PGlite } = await import('@electric-sql/pglite')); // a git worktree resolves the main checkout's node_modules
  } catch {
    out('admin-fronts-sql-pglite: SKIP (@electric-sql/pglite not installed)');
    process.exit(0);
  }
}

const read = (f) => fs.readFileSync(path.join(repo, 'migrations', f), 'utf8');
const M134 = read('134_admin_fronts.sql');
const M115 = read('115_front_sweep_and_alarm_floor.sql');
const SWEEP_FN = M115.slice(
  M115.indexOf('CREATE OR REPLACE FUNCTION public.assign_fronts_sweep'),
  M115.indexOf('COMMENT ON FUNCTION public.assign_fronts_sweep')
);

const SCHEMA = String.raw`
create role anon; create role authenticated; create role service_role;
create table public.events(
  id bigint generated always as identity primary key, slug text not null unique, name text not null,
  publish_state text not null default 'draft', sweep_pattern text, sweep_coword text,
  sweep_priority smallint not null default 100, sweep_summary boolean not null default false,
  agent_pattern text, agent_definition text);
create table public.event_updates(
  id bigint generated always as identity primary key,
  event_id bigint not null references public.events(id) on delete cascade,
  constraint event_updates_id_event_unique unique (id, event_id));
create table public.stories(
  id bigint primary key, status text, merged_into_story_id bigint, primary_headline text,
  summary_neutral text, first_seen_at timestamptz default now(), last_updated_at timestamptz default now(),
  last_enriched_at timestamptz, action_label text);
create table public.story_event(
  story_id bigint primary key references public.stories(id) on delete cascade,
  event_id bigint not null references public.events(id) on delete cascade,
  event_update_id bigint references public.event_updates(id) on delete set null,
  assigned_by text not null check (assigned_by in ('agent','human')),
  confidence numeric, assigned_at timestamptz not null default now(), reassigned_at timestamptz,
  reassigned_from_event_id bigint references public.events(id) on delete set null, note text,
  constraint story_event_update_same_event_fkey foreign key (event_update_id, event_id)
    references public.event_updates(id, event_id));
insert into public.events(slug, name, publish_state, sweep_pattern, sweep_coword, sweep_priority, sweep_summary, agent_pattern, agent_definition) overriding system value values
 ('epstein-files', 'The Epstein Files', 'published', 'epstein', null, 60, false, 'epstein|maxwell', 'def'),
 ('iran', 'Iran', 'published', '\miran(ian)?\M', '^(?!.*iranian revolution)', 80, false, null, null),
 ('rfk-hhs', 'RFK Jr.''s HHS', 'draft', null, null, 85, false, 'budget', 'def'),
 ('election-suppression', 'Election Suppression', 'published', '(usps|mail ballot)', '(election|vote|ballot)', 50, true, null, null);
insert into public.event_updates(event_id) values (1);
insert into public.stories(id, status, merged_into_story_id, primary_headline, summary_neutral, first_seen_at) values
 (1, 'active', null, 'Epstein estate releases new documents', 's', now() - interval '2 days'),
 (2, 'active', null, 'US strikes Iran nuclear site', 's', now() - interval '3 days'),
 (3, 'active', null, 'CDC vaccine panel fired', 's', now() - interval '1 day'),
 (4, 'active', null, 'Maxwell moved to a softer prison', 'Ghislaine Maxwell, Epstein associate', now() - interval '5 days'),
 (5, 'merged_into', 9, 'Epstein files dupe', 's', now() - interval '5 days'),
 (6, 'active', null, 'A quiet budget story', 's', now() - interval '1 day'),
 (7, 'active', null, 'Election board changes ballot rules', 'The USPS will stop', now() - interval '1 day'),
 (8, 'active', null, 'Old Epstein story', 's', now() - interval '200 days'),
 (9, 'active', null, 'Epstein survivor testifies', null, now() - interval '1 day');
insert into public.stories(id, status, primary_headline, summary_neutral, first_seen_at, action_label) values
 (10, 'active', 'Maxwell interview recap', 's', now() - interval '1 day', 'coverage');
insert into public.story_event(story_id, event_id, assigned_by, confidence, event_update_id, note) values
 (2, 2, 'agent', 0.8, null, null),
 (1, 1, 'agent', 0.8, 1, 'fronts-v2: epstein-files: names Epstein');
`;

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) out(`  ok   ${name}`);
  else { failures++; out(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`); }
};
const rowsOf = async (sql, params) => (await db.query(sql, params)).rows;
const se = async (id) => (await rowsOf('select * from public.story_event where story_id = $1', [id]))[0];
const assign = (ids, ev, move = false, from = null) => rowsOf('select * from public.admin_assign_stories_to_front($1::bigint[], $2, $3, $4::bigint[])', [ids, ev, move, from]);
const byStory = (rows, id) => rows.find((r) => Number(r.story_id) === id);
const fails = async (sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(SWEEP_FN);
await db.exec(M134);

// --- assign ---------------------------------------------------------------------------
let r = await assign([3, 3, 1, 2, 5, 999], 3);
check('duplicate ids collapse to one result each', r.length === 5, JSON.stringify(r));
check('new story is assigned', byStory(r, 3)?.status === 'assigned');
check('story on another front is reported, not moved', byStory(r, 1)?.status === 'on_other_front' && Number(byStory(r, 1)?.from_event_id) === 1);
check('missing story reported', byStory(r, 999)?.status === 'story_not_found');
check('merged story never filed', byStory(r, 5)?.status === 'story_not_active' && !(await se(5)));
let row = await se(3);
check('hand assignment is human with no confidence', row.assigned_by === 'human' && row.confidence === null && Number(row.event_id) === 3);
check('no-move left story 1 alone', Number((await se(1)).event_id) === 1);

r = await assign([3], 3);
check('re-filing is already_on_front', r[0]?.status === 'already_on_front');

check('a move without the source fronts raises', (await fails('select * from public.admin_assign_stories_to_front(array[1]::bigint[], 3, true)'))?.includes('p_from_event_ids'));
check('a move with too few source fronts raises', (await fails('select * from public.admin_assign_stories_to_front(array[1,2]::bigint[], 3, true, array[1]::bigint[])'))?.includes('p_from_event_ids'));
check('a move with a NULL source front raises', (await fails('select * from public.admin_assign_stories_to_front(array[1]::bigint[], 3, true, array[null]::bigint[])'))?.includes('p_from_event_ids'));
r = await assign([1], 3, true, [2]);   // the screen thinks story 1 is on front 2; it is on 1
check('stale move is reported where the story really is, not moved', r[0]?.status === 'on_other_front' && Number(r[0]?.from_event_id) === 1 && Number((await se(1)).event_id) === 1, JSON.stringify(r));

r = await assign([1], 3, true, [1]);
row = await se(1);
check('move reports from_event_id', r[0]?.status === 'moved' && Number(r[0]?.from_event_id) === 1);
check('move writes reassigned_at + from', row.reassigned_at !== null && Number(row.reassigned_from_event_id) === 1 && Number(row.event_id) === 3);
check('move clears the old front update link', row.event_update_id === null);
check('move keeps the original assigned_by', row.assigned_by === 'agent');
check('move clears the old confidence', row.confidence === null);
check('move note keeps the first reason', row.note === 'moved by hand in admin; first filed as: fronts-v2: epstein-files: names Epstein', row.note);

r = await assign([1], 2, true, [3]);
row = await se(1);
check('second move keeps the FIRST reassigned_from_event_id', Number(row.reassigned_from_event_id) === 1 && Number(row.event_id) === 2, JSON.stringify(row));
check('second move keeps the note (no double prefix)', row.note === 'moved by hand in admin; first filed as: fronts-v2: epstein-files: names Epstein', row.note);

// one call, two source fronts (a pool move): story 1 is on 2, story 3 on 3; 3's entry is stale
r = await assign([3, 1, 1], 1, true, [2, 2, 9]);
check('mixed-source move: each story checked against its own source (first entry wins on repeats)',
  byStory(r, 1)?.status === 'moved' && Number(byStory(r, 1)?.from_event_id) === 2 && Number((await se(1)).event_id) === 1
  && byStory(r, 3)?.status === 'on_other_front' && Number((await se(3)).event_id) === 3 && r.length === 2, JSON.stringify(r));
await assign([1], 2, true, [1]);   // put story 1 back on front 2 for the checks below

// a stale move of a story whose membership was removed meanwhile never files it (Codex P1 on f458994)
await assign([6], 3);
await rowsOf('select * from public.admin_unassign_stories(array[6]::bigint[], 3)');
r = await assign([6], 1, true, [3]);
check('stale move of a removed story: no_longer_on_front, nothing filed', r[0]?.status === 'no_longer_on_front' && r[0]?.from_event_id === null && !(await se(6)), JSON.stringify(r));
r = await assign([6, 1], 1, true, [3, 2]);
check('a removed story does not block the rest of the move', byStory(r, 6)?.status === 'no_longer_on_front' && byStory(r, 1)?.status === 'moved' && !(await se(6)), JSON.stringify(r));
await assign([1], 2, true, [1]);   // back on front 2 again

check('unknown front raises', (await fails('select * from public.admin_assign_stories_to_front(array[6]::bigint[], 4242, false)'))?.includes('not found'));
check('more than 200 ids raises', (await fails('select * from public.admin_assign_stories_to_front((select array_agg(g)::bigint[] from generate_series(1,201) g), 1, false)'))?.includes('at most 200'));
check('empty array returns nothing', (await assign([], 1)).length === 0);

// --- unassign + sweep agreement ------------------------------------------------------------
await assign([4, 6, 7, 10], 3);        // filed by hand onto rfk-hhs (no sweep rule; a draft, so not an agent front)
r = await rowsOf('select * from public.admin_unassign_stories(array[4, 6, 7, 10, 2]::bigint[], 3)');
check('unassign removes from the named front', byStory(r, 4)?.status === 'removed' && byStory(r, 6)?.status === 'removed' && byStory(r, 7)?.status === 'removed');
check('unassign leaves another front alone', byStory(r, 2)?.status === 'not_on_front' && Number((await se(2)).event_id) === 2);
check('headline match flagged for re-file (4: "Maxwell" is agent-only, so no)', byStory(r, 4)?.sweep_would_refile === false, JSON.stringify(byStory(r, 4)));
check('summary match behind a coword flagged (7)', byStory(r, 7)?.sweep_would_refile === true);
check('no rule match not flagged (6)', byStory(r, 6)?.sweep_would_refile === false);
check('agent pattern on a live agent front flagged (4)', byStory(r, 4)?.agent_may_refile === true, JSON.stringify(byStory(r, 4)));
check('coverage-labeled story not flagged for the agent (10)', byStory(r, 10)?.agent_may_refile === false);
check('a draft front agent pattern is ignored (6 matches rfk "budget")', byStory(r, 6)?.agent_may_refile === false);
check('a row that was not removed carries false flags (2)', byStory(r, 2)?.agent_may_refile === false && byStory(r, 2)?.sweep_would_refile === false);
await rowsOf('select * from public.assign_fronts_sweep(null)');
check('sweep agrees: 7 re-filed', Number((await se(7))?.event_id) === 4);
check('sweep agrees: 4 and 6 stay unfiled', !(await se(4)) && !(await se(6)));

// --- pattern check ---------------------------------------------------------------------------
const pat = async (p) => (await rowsOf('select public.admin_check_front_pattern($1) as e', [p]))[0].e;
check('valid regex -> NULL', (await pat('(ok|fine)')) === null);
check('lookahead coword is valid', (await pat('^(?!.*iranian revolution)')) === null);
check('word boundary pattern is valid', (await pat('\\miran(ian)?\\M')) === null);
check('broken regex -> message', typeof (await pat('(broken')) === 'string' && (await pat('(broken')).length > 0);
check('NULL pattern -> NULL', (await pat(null)) === null);

// --- preview -------------------------------------------------------------------------------
await db.exec('delete from public.story_event where story_id = 4');
let p = await rowsOf("select * from public.admin_preview_front_rule('epstein', null, false, 'sweep', 30, 1)");
// pool: active, enriched, last 30 days -> 1 (now on iran), 4 (summary only), 9 (unenriched: out), 8 (old: out), 5 (merged: out)
check('sweep preview: headline-only match count', p[0]?.total_matches === 1 && p[0]?.on_other_front === 1 && p[0]?.unassigned === 0, JSON.stringify(p));
p = await rowsOf("select * from public.admin_preview_front_rule('epstein|maxwell', null, false, 'agent', 30, 1)");
check('agent preview: headline or summary', p[0]?.total_matches === 2 && p[0]?.unassigned === 1, JSON.stringify(p));
check('agent preview: newest sample first with front name', Number(p[0]?.sample_story_id) === 4 && p[1]?.sample_front === 'Iran', JSON.stringify(p));
p = await rowsOf("select * from public.admin_preview_front_rule('(usps)', '(election|ballot)', true, 'sweep', 30, 4)");
check('sweep preview: summary match behind a coword counts as this front', p[0]?.total_matches === 1 && p[0]?.on_this_front === 1, JSON.stringify(p));
p = await rowsOf("select * from public.admin_preview_front_rule('nothing-matches-this', null, false, 'sweep', 30, 1)");
check('zero matches still returns the counts row', p.length === 1 && p[0].total_matches === 0 && p[0].sample_story_id === null, JSON.stringify(p));
p = await rowsOf("select * from public.admin_preview_front_rule('epstein', null, false, 'sweep', 365, 1)");
check('days are capped at 90 (200-day story stays out)', p[0]?.total_matches === 1, JSON.stringify(p));
check('bad kind raises', (await fails("select * from public.admin_preview_front_rule('x', null, false, 'nope', 30, 1)"))?.includes('kind'));

// --- set_update_stories ----------------------------------------------------------------------
// fresh fixture: stories 20-23 on front 1 (21 on update A), 24 on front 2; updates A and B on front 1
await db.exec(`
  insert into public.stories(id, status, primary_headline, summary_neutral) values
    (20,'active','Epstein a','s'),(21,'active','Epstein b','s'),(22,'active','Epstein c','s'),(23,'active','Epstein d','s'),(24,'active','Iran e','s');
  insert into public.event_updates(event_id) values (1), (1), (2);`);
const [uA, uB, uIran] = (await rowsOf('select id from public.event_updates order by id desc limit 3')).map((x) => Number(x.id)).reverse();
await db.exec(`insert into public.story_event(story_id, event_id, assigned_by, event_update_id) values
  (20,1,'human',null),(21,1,'human',${uA}),(22,1,'human',null),(23,1,'human',${uB}),(24,2,'human',null);`);
const setU = async (ev, u, ids) => (await rowsOf('select public.admin_set_update_stories($1, $2, $3::bigint[]) as r', [ev, u, ids]))[0].r;
const linksOf = async (u) => (await rowsOf('select story_id from public.story_event where event_update_id = $1 order by story_id', [u])).map((x) => Number(x.story_id));

let L = await setU(1, uB, [20, 21, 24, 999]);
check('set: links the stories on this front', JSON.stringify(L.linked) === '[20,21]', JSON.stringify(L));
check('set: other-front and missing stories reported, not filed', JSON.stringify(L.not_on_front) === '[24,999]' && Number((await se(24)).event_id) === 2, JSON.stringify(L));
check('set: reports a story taken from another update', JSON.stringify(L.taken_from_other_update) === '[21]', JSON.stringify(L));
check('set: unlinks what is no longer requested', JSON.stringify(L.unlinked) === '[23]', JSON.stringify(L));
check('set: the update holds exactly the requested set', JSON.stringify(await linksOf(uB)) === '[20,21]' && (await linksOf(uA)).length === 0);
L = await setU(1, uB, [22]);
check('set: a second save replaces the whole set', JSON.stringify(await linksOf(uB)) === '[22]' && JSON.stringify(L.unlinked) === '[20,21]', JSON.stringify(L));
L = await setU(1, uB, []);
check('set: an empty list clears the update', (await linksOf(uB)).length === 0 && JSON.stringify(L.unlinked) === '[22]', JSON.stringify(L));
check('set: an update on another front raises', (await fails('select public.admin_set_update_stories(1, $1, array[20]::bigint[])', [uIran]))?.includes('not found'));
check('set: failure leaves links untouched (one transaction)', (await linksOf(uIran)).length === 0);

// --- grants --------------------------------------------------------------------------------
const FNS = `('admin_assign_stories_to_front','admin_unassign_stories','admin_check_front_pattern','admin_preview_front_rule','admin_set_update_stories')`;
const priv = await rowsOf(`select p.proname,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as svc
  from pg_proc p where p.proname in ${FNS}`);
check('five functions created', priv.length === 5, JSON.stringify(priv));
check('anon/authenticated cannot execute, service_role can', priv.every((x) => !x.anon && !x.auth && x.svc), JSON.stringify(priv));

// --- idempotent, and over the first revision (3-argument assign) ----------------------------
await db.exec(`create function public.admin_assign_stories_to_front(p_story_ids bigint[], p_event_id bigint, p_move boolean default false)
  returns table (story_id bigint, status text, from_event_id bigint) language sql as $$ select null::bigint, null::text, null::bigint where false $$;`);
let rerun = null; try { await db.exec(M134); } catch (e) { rerun = e.message; }
check('re-run is clean', rerun === null, rerun);
const versions = await rowsOf(`select pg_get_function_identity_arguments(oid) as args from pg_proc where proname = 'admin_assign_stories_to_front'`);
check('re-run over the first revision leaves ONE assign (per-story source fronts)', versions.length === 1 && versions[0].args.endsWith('p_from_event_ids bigint[]'), JSON.stringify(versions));
// deadlock guard: the unlinked rows are locked up front with the requested ones
check('set_update_stories locks unlinked rows before writing', /OR se\.event_update_id = p_update_id\s+ORDER BY se\.story_id\s+FOR UPDATE/.test(M134));

await db.close();
out(failures ? `admin-fronts-sql-pglite: ${failures} FAILED` : 'admin-fronts-sql-pglite: all passed');
process.exit(failures ? 1 : 0);
