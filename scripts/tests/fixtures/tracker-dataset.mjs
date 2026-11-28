// Shared PGlite fixture for the Tracker refresh tests (migrations 136-138): a stories schema shaped
// like PROD where it matters to the planner, and a realistic synthetic dataset (tens of thousands of
// stories, fronts, memberships, pins). The real tracker_stats table and main-line index (113),
// homepage view (123) and rule view (126) are sliced out of the migration files and migration 136
// is applied whole, so the tests exercise the SQL that ships, not a copy.
import { migration } from './pglite.mjs';

/** The query plan of `sql`, as one string. */
export const plan = async (db, sql) => (await db.query(`explain ${sql}`)).rows.map((r) => r['QUERY PLAN']).join('\n');

/** One refresh_tracker_derived call with batch size `n` (null = everything); its result row. */
export const refresh = async (db, n) => (await db.query('select * from public.refresh_tracker_derived($1)', [n])).rows[0];

/** The text of `file` from the first `from` marker up to (not including) the `to` marker. */
function slice(file, from, to) {
  const sql = migration(file);
  const a = sql.indexOf(from);
  const b = sql.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error(`${file}: marker not found: ${from} / ${to}`);
  return sql.slice(a, b);
}

// Columns the rule, the refresh and the homepage read, plus `body` to give rows a realistic width
// (PROD rows carry summaries and article text, so a heap page holds a handful of stories, not hundreds).
const SCHEMA = String.raw`
create role anon; create role authenticated; create role service_role;
create table public.stories(
  id bigint primary key,
  status text not null default 'active',
  summary_neutral text,
  first_seen_at timestamptz not null,
  primary_headline text not null,
  alarm_level smallint,
  severity text,
  action_label text,
  action_actor text,
  main_line boolean not null default false,
  body text);
create index ix_stories_status_first_seen on public.stories (status, first_seen_at desc);
create index stories_alarm_level_idx on public.stories (alarm_level);
create table public.events(id bigint primary key, name text not null, slug text not null,
  publish_state text not null default 'draft', lifecycle text not null default 'open');
create table public.story_event(story_id bigint primary key references public.stories(id) on delete cascade,
  event_id bigint not null references public.events(id) on delete cascade);
create index idx_story_event_event_id on public.story_event (event_id);
create table public.tracker_pin(source text not null, entity_id text not null, pin text not null,
  updated_at timestamptz not null default now(), primary key (source, entity_id));
create table public.scotus_cases(id bigint primary key, is_public boolean, decided_at date, ruling_impact_level smallint);
create table public.executive_orders(id bigint primary key, is_public boolean, date date, alarm_level smallint);
create table public.pardons(id bigint primary key, is_public boolean, pardon_date date, corruption_level smallint);
-- Anon reads these on PROD (through RLS policies), so a homepage query run as anon only fails
-- if a migration forgets the grant on a table it adds.
grant select on public.stories, public.events, public.story_event, public.tracker_pin to anon;
grant all on public.stories, public.events, public.story_event, public.tracker_pin to service_role;
`;

// Deterministic pseudo-random spread (no random(): every run must see the same data).
// ~30,000 stories over two years, ~16,000 active and enriched; 60 fronts (45 published); about a
// third of active stories on a front; 300 story pins; all four action labels and actors.
const SEED = String.raw`
insert into public.stories(id, status, summary_neutral, first_seen_at, primary_headline,
                           alarm_level, severity, action_label, action_actor, body)
select g,
       case when g % 13 = 0 then 'closed' when g > 14000 or g % 3 <> 0 then 'active' else 'closed' end,
       case when g % 29 = 0 then null else 'neutral summary ' || g end,
       timestamptz '2025-01-21' + (g * interval '33 minutes') - ((g * 7919) % 600) * interval '1 minute',
       'Headline number ' || g || ' about something that happened',
       case when g % 17 = 0 then null else 1 + (g * 31) % 5 end,
       case (g * 13) % 4 when 0 then 'critical' when 1 then 'severe' when 2 then 'moderate' else 'minor' end,
       case (g * 7) % 5 when 0 then null when 1 then 'did' when 2 then 'said' when 3 then 'coverage' else 'did' end,
       case (g * 11) % 4 when 0 then 'trump' when 1 then 'administration' when 2 then 'ally' else 'other' end,
       repeat('article text ', 60)
  from generate_series(1, 30000) g;
insert into public.events(id, name, slug, publish_state, lifecycle)
select g, 'Front ' || g, 'front-' || g,
       case when g % 4 = 0 then 'draft' else 'published' end,
       case when g % 10 = 0 then 'resolved' else 'open' end
  from generate_series(1, 60) g;
insert into public.story_event(story_id, event_id)
select id, 1 + (id * 37) % 60 from public.stories where id % 3 = 1;
insert into public.tracker_pin(source, entity_id, pin)
select 'stories', (g * 97)::text, case when g % 3 = 0 then 'force_hide' else 'force_show' end
  from generate_series(1, 300) g;
insert into public.scotus_cases select g, true, date '2025-02-01' + g, 1 + g % 5 from generate_series(1, 80) g;
insert into public.executive_orders select g, g % 9 <> 0, date '2025-01-21' + g, 1 + g % 5 from generate_series(1, 250) g;
insert into public.pardons select g, true, date '2025-01-21' + g * 2, 1 + g % 5 from generate_series(1, 120) g;
`;

// The rule view as migration 126 ships it (CREATE VIEW through its GRANT).
const RULE_VIEW = () => slice('126_main_line_rule_v2.sql', 'DROP VIEW IF EXISTS public.v_tracker_main_line_rule;', 'SELECT * FROM public.refresh_tracker_derived();');
// tracker_stats (113 PART B) and the main-line index (113 PART A, minus the column the fixture already has).
const STATS_TABLE = () => slice('113_tracker_precompute.sql', '-- PART B:', '-- PART C:');
const MAIN_LINE_INDEX = () => slice('113_tracker_precompute.sql', 'DROP INDEX IF EXISTS public.idx_stories_tracker_main_line;', '-- ====');
// v_tracker_stories as it is today (migration 123 PART D).
const HOMEPAGE_VIEW = () => slice('123_story_action_labels.sql', 'CREATE OR REPLACE VIEW public.v_tracker_stories', 'NOTIFY pgrst');

/**
 * A database with the dataset loaded, migration 136 applied, the main line refreshed once (so the
 * steady state is "nothing to change") and statistics gathered.
 */
export async function trackerDb(PGlite) {
  const db = new PGlite();
  // PGlite ships with enable_seqscan = off; Supabase runs with it on. Without this every plan in
  // these tests would lean towards index scans the real planner might not pick.
  await db.exec('set enable_seqscan = on');
  await db.exec(SCHEMA);
  await db.exec(SEED);
  await db.exec(STATS_TABLE());
  await db.exec(MAIN_LINE_INDEX());
  await db.exec(RULE_VIEW());
  await db.exec(HOMEPAGE_VIEW());
  await db.exec(migration('136_refresh_tracker_batches.sql'));
  await db.query('select * from public.refresh_tracker_derived()');
  await db.exec('vacuum analyze');
  return db;
}

/**
 * Change the rule's inputs on exactly `n` unpinned in-scope stories (spread across all ids) so the
 * rule now disagrees with their stored flag: half go off (labelled coverage), half come on (an
 * alarm-5 loose end that trump did).
 */
export async function makeDrift(db, n) {
  await db.query(`
    with candidates as (
      select s.id, s.main_line,
             row_number() over (partition by s.main_line order by (s.id * 7907) % 30011) as k
        from public.stories s
       where s.status = 'active' and s.summary_neutral is not null
         and s.id::text not in (select entity_id from public.tracker_pin)
         and (s.main_line or s.id not in (select story_id from public.story_event))),
    picked as (
      select id, main_line from candidates
       where k <= case when main_line then $1 / 2 else $1 - $1 / 2 end)
    update public.stories s
       set action_label = case when p.main_line then 'coverage' else 'did' end,
           alarm_level  = case when p.main_line then s.alarm_level else 5 end,
           action_actor = case when p.main_line then s.action_actor else 'trump' end
      from picked p
     where s.id = p.id`, [n]);
}

/** Milliseconds for one call of `sql`, best of `runs` (PGlite timing is noisy on the first run). */
export async function timeQuery(db, sql, params = [], runs = 3) {
  let best = Infinity;
  for (let i = 0; i < runs; i += 1) {
    const t = performance.now();
    await db.query(sql, params);
    best = Math.min(best, performance.now() - t);
  }
  return best;
}
