// Runs migration 123 (ADO-594 S1: action labels + human-label lock) on PGlite (Postgres 17)
// against a minimal copy of the tracker schema, then checks:
//   value CHECKs, the source default, the one door (set_story_action_label), the lock trigger
//   (agent PATCH, backfill write, plain PATCH, sneaky source=human, INSERT), unlock, the flag being
//   off again after the RPC inside one transaction, v_tracker_stories columns, idempotent re-run.
// Not part of qa:smoke: @electric-sql/pglite is not a declared dependency, so the test SKIPS
// (exit 0) when it is missing. Run: node scripts/tests/action-labels-sql-pglite.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = (s) => process.stdout.write(`${s}\n`);

let PGlite;
try {
  ({ PGlite } = await import(pathToFileURL(path.join(repo, 'node_modules/@electric-sql/pglite/dist/index.js')).href));
} catch {
  out('action-labels-sql-pglite: SKIP (@electric-sql/pglite not installed)');
  process.exit(0);
}

const MIGRATION = fs.readFileSync(path.join(repo, 'migrations/123_story_action_labels.sql'), 'utf8');

const SCHEMA = String.raw`
create role anon; create role authenticated; create role service_role;
create table public.events(id bigserial primary key, slug text, name text, publish_state text);
create table public.stories(
  id bigint primary key, status text, primary_headline text, summary_neutral text,
  first_seen_at timestamptz default now(), alarm_level smallint, severity text,
  main_line boolean not null default false);
create table public.story_event(story_id bigint primary key references public.stories(id),
  event_id bigint references public.events(id));
create table public.tracker_pin(source text, entity_id text, pin text, primary key(source, entity_id));
create view public.v_tracker_stories with (security_invoker = true) as
  select s.id, s.primary_headline, s.first_seen_at, s.alarm_level, s.severity,
         e.id as front_id, e.name as front_name, e.slug as front_slug, p.pin as tracker_pin, s.main_line
    from public.stories s
    left join public.story_event se on se.story_id = s.id
    left join public.events e on e.id = se.event_id and e.publish_state = 'published'
    left join public.tracker_pin p on p.source = 'stories' and p.entity_id = s.id::text
   where s.status = 'active' and s.summary_neutral is not null;
grant select on public.v_tracker_stories to anon;
insert into public.events(id, slug, name, publish_state) values (1, 'iran', 'Iran', 'published');
insert into public.stories(id, status, primary_headline, summary_neutral, alarm_level) values
  (1, 'active', 'US destroys Iranian tankers', 'sum', 4),
  (2, 'active', 'Trump threatens to bar Bombardier', 'sum', 3),
  (3, 'active', 'Midterms kick into high gear', 'sum', 2),
  (4, 'active', 'Worker injured at White House', 'sum', 2);
insert into public.story_event(story_id, event_id) values (1, 1);
`;

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) out(`  ok   ${name}`);
  else { failures++; out(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`); }
};
const throws = async (fn) => { try { await fn(); return false; } catch { return true; } };

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(MIGRATION);

const row = async (id) => (await db.query(
  'select action_label, action_actor, action_label_source, summary_neutral, alarm_level from public.stories where id = $1', [id])).rows[0];

out('action-labels-sql-pglite');

// 1. Value checks
check('bad label rejected', await throws(() => db.exec("update public.stories set action_label='maybe', action_actor='trump' where id=3")));
check('bad actor rejected', await throws(() => db.exec("update public.stories set action_label='did', action_actor='ceo' where id=3")));
check('bad source rejected', await throws(() => db.exec("update public.stories set action_label='did', action_actor='other', action_label_source='robot' where id=3")));
await db.exec("update public.stories set action_label='coverage', action_actor='other', action_label_source='backfill' where id=3");
await db.exec('update public.stories set action_label_source=null where id=3');
check('clearing the source of a labeled row refills agent', (await row(3)).action_label_source === 'agent');

// 2. Agent PATCH without a source gets 'agent'
await db.exec("update public.stories set action_label='did', action_actor='administration', summary_neutral='agent sum' where id=1");
let r = await row(1);
check('label without source defaults to agent', r.action_label_source === 'agent', JSON.stringify(r));

// 3. Backfill write on an unlabeled row
await db.exec("update public.stories set action_label='said', action_actor='trump', action_label_source='backfill' where id=2");
r = await row(2);
check('backfill write lands', r.action_label === 'said' && r.action_label_source === 'backfill', JSON.stringify(r));

// 3b. Agent relabel over a backfill label without sending a source -> agent
await db.exec("insert into public.stories(id, status, primary_headline, summary_neutral, action_label, action_actor, action_label_source) values (6, 'active', 'y', 'sum', 'coverage', 'other', 'backfill')");
await db.exec("update public.stories set action_label='did', action_actor='administration' where id=6");
r = await row(6);
check('agent relabel over backfill (no source sent) becomes agent', r.action_label === 'did' && r.action_label_source === 'agent', JSON.stringify(r));
await db.exec("update public.stories set summary_neutral='s2' where id=6");
check('unrelated write keeps source', (await row(6)).action_label_source === 'agent');

// 4. The door sets a human label
const set = (await db.query("select * from public.set_story_action_label(2, 'did', 'trump')")).rows[0];
check('RPC sets human label and returns it', set.action_label === 'did' && set.action_label_source === 'human', JSON.stringify(set));

// 5. Agent re-enrichment PATCH on a human row: summary/alarm saved, label restored
await db.exec("update public.stories set summary_neutral='new sum', alarm_level=4, action_label='coverage', action_actor='other', action_label_source='agent' where id=2");
r = await row(2);
check('agent PATCH keeps human label', r.action_label === 'did' && r.action_actor === 'trump' && r.action_label_source === 'human', JSON.stringify(r));
check('agent PATCH still saves summary and alarm', r.summary_neutral === 'new sum' && r.alarm_level === 4, JSON.stringify(r));

// 6. Backfill write on a human row
await db.exec("update public.stories set action_label='coverage', action_actor='other', action_label_source='backfill' where id=2");
r = await row(2);
check('backfill write keeps human label', r.action_label === 'did' && r.action_label_source === 'human', JSON.stringify(r));

// 7. Plain PATCH that claims human without the door
await db.exec("update public.stories set action_label='coverage', action_actor='other', action_label_source='human' where id=4");
r = await row(4);
check('source=human without the door is ignored', r.action_label === null && r.action_label_source === null, JSON.stringify(r));

// 8. Unrelated write on a human row (refresh_tracker_derived style) leaves the label
await db.exec('update public.stories set main_line = true where id = 2');
r = await row(2);
check('main_line refresh write keeps human label', r.action_label === 'did' && r.action_label_source === 'human', JSON.stringify(r));

// 9. Flag is off again after the RPC inside the same transaction
await db.exec(`begin;
  select * from public.set_story_action_label(3, 'said', 'trump');
  update public.stories set action_label='coverage', action_label_source='agent' where id=3;
  commit;`);
r = await row(3);
check('flag off after RPC in same transaction', r.action_label === 'said' && r.action_label_source === 'human', JSON.stringify(r));

// 10. Unlock: label stays, source back to agent, next agent write relabels
const un = (await db.query('select * from public.set_story_action_label(3, null, null, true)')).rows[0];
check('unlock keeps label, source agent', un.action_label === 'said' && un.action_label_source === 'agent', JSON.stringify(un));
await db.exec("update public.stories set action_label='coverage', action_actor='other', action_label_source='agent' where id=3");
r = await row(3);
check('after unlock the agent can relabel', r.action_label === 'coverage', JSON.stringify(r));
const un2 = (await db.query('select * from public.set_story_action_label(1, null, null, true)')).rows[0];
check('unlock of a non-human row is a no-op', un2.action_label_source === 'agent', JSON.stringify(un2));

// 11. RPC guards
check('RPC rejects unknown story', await throws(() => db.query("select * from public.set_story_action_label(999, 'did', 'trump')")));
check('RPC rejects missing label', await throws(() => db.query("select * from public.set_story_action_label(1, null, 'trump')")));
check('RPC rejects bad label value', await throws(() => db.query("select * from public.set_story_action_label(1, 'maybe', 'trump')")));
r = await row(1);
check('failed RPC leaves the row alone', r.action_label === 'did' && r.action_label_source === 'agent', JSON.stringify(r));

// 12. INSERT claiming human
await db.exec("insert into public.stories(id, status, primary_headline, summary_neutral, action_label, action_actor, action_label_source) values (5, 'active', 'x', 'sum', 'did', 'trump', 'human')");
r = await row(5);
check('INSERT with source=human is stripped', r.action_label === null && r.action_label_source === null, JSON.stringify(r));

// 13. View exposes the labels, not the source
const cols = (await db.query("select column_name from information_schema.columns where table_name='v_tracker_stories' order by ordinal_position")).rows.map((x) => x.column_name);
check('view appends action_label, action_actor', cols.at(-2) === 'action_label' && cols.at(-1) === 'action_actor', cols.join(','));
check('view keeps action_label_source private', !cols.includes('action_label_source'));
const v = (await db.query('select action_label, front_slug from public.v_tracker_stories where id = 1')).rows[0];
check('view returns label with front join intact', v.action_label === 'did' && v.front_slug === 'iran', JSON.stringify(v));
const anonGrant = (await db.query("select has_table_privilege('anon', 'public.v_tracker_stories', 'select') as g")).rows[0].g;
check('anon still has the view grant', anonGrant === true);
const anonExec = (await db.query("select has_function_privilege('anon', 'public.set_story_action_label(bigint,text,text,boolean)', 'execute') as g")).rows[0].g;
check('anon cannot call the door', anonExec === false);

// 14. Idempotent re-run keeps data and the lock
await db.exec(MIGRATION);
r = await row(2);
check('re-run keeps labels', r.action_label === 'did' && r.action_label_source === 'human', JSON.stringify(r));
const trig = (await db.query("select count(*)::int as n from pg_trigger where tgname='stories_action_label_lock'")).rows[0].n;
check('re-run leaves one trigger', trig === 1, String(trig));
const last = (await db.query(MIGRATION.slice(MIGRATION.lastIndexOf('SELECT\n')))).rows[0];
check('final check query first column is labeled_stories', Object.keys(last)[0] === 'labeled_stories', JSON.stringify(last));

await db.close();
out(failures ? `action-labels-sql-pglite: ${failures} FAILED` : 'action-labels-sql-pglite: all passed');
process.exit(failures ? 1 : 0);
