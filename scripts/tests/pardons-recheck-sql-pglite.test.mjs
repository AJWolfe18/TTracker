// Runs migration 132 (ADO-524: post-pardon recheck rotation) on PGlite (Postgres 17) against a
// minimal copy of the pardons table, then checks: the checked_at backfill (NULLs only), the due
// rule (14-day tier inside 180 days of the pardon, 60-day tier after), the exclusions (unpublished,
// unenriched, group cards, id 3), the order (never checked first, then oldest check, then id), the
// limit clamp, pool_size, grants, an idempotent re-run that keeps a newer stamp, and the final check.
// Not part of qa:smoke: @electric-sql/pglite is not a declared dependency, so the test SKIPS
// (exit 0) when it is missing. Run: node scripts/tests/pardons-recheck-sql-pglite.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = (s) => process.stdout.write(`${s}\n`);

let PGlite;
try {
  ({ PGlite } = await import(pathToFileURL(path.join(repo, 'node_modules/@electric-sql/pglite/dist/index.js')).href));
} catch {
  out('pardons-recheck-sql-pglite: SKIP (@electric-sql/pglite not installed)');
  process.exit(0);
}

const M132 = fs.readFileSync(path.join(repo, 'migrations/132_pardons_post_pardon_recheck.sql'), 'utf8');

// Dates are relative to now() so the tiers hold whenever the test runs.
const SCHEMA = String.raw`
create role anon; create role authenticated; create role service_role;
create table public.pardons(
  id bigint primary key, recipient_name text not null, recipient_type text not null default 'person',
  pardon_date date not null, clemency_type text not null default 'pardon', conviction_district text,
  case_number text, offense_raw text, post_pardon_status text not null default 'quiet',
  post_pardon_notes text, enriched_at timestamptz, is_public boolean not null default false,
  summary_neutral text);
insert into public.pardons(id, recipient_name, recipient_type, pardon_date, enriched_at, is_public) values
  -- recent tier (pardoned within 180 days): due after 14 days
  (101, 'Recent, checked 20 days ago',  'person', current_date - 30,  now() - interval '20 days', true),
  (102, 'Recent, checked 5 days ago',   'person', current_date - 30,  now() - interval '5 days',  true),
  -- older tier: due after 60 days
  (201, 'Old, checked 90 days ago',     'person', current_date - 400, now() - interval '90 days', true),
  (202, 'Old, checked 30 days ago',     'person', current_date - 400, now() - interval '30 days', true),
  (203, 'Old, checked 61 days ago',     'person', current_date - 400, now() - interval '61 days', true),
  -- tier boundary: 179 days ago is still the recent tier (due at 14 days)
  (301, 'Boundary, recent tier',        'person', current_date - 179, now() - interval '20 days', true),
  -- exclusions
  (401, 'Unpublished',                  'person', current_date - 400, now() - interval '90 days', false),
  (402, 'Unenriched',                   'person', current_date - 400, null,                       true),
  (403, 'Group card',                   'group',  current_date - 400, now() - interval '90 days', true),
  (3,   'January 6th Mass Pardon',      'person', current_date - 400, now() - interval '90 days', true);
`;

let failures = 0;
const check = (ok, label) => { if (!ok) failures += 1; out(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };
const due = async (db, n = 10) => (await db.query(`select * from public.pardons_due_for_recheck(${n})`)).rows;

const db = new PGlite();
await db.exec(SCHEMA);
// A hand-enriched row with no date and an already-stamped row exercise the backfill.
await db.exec(`insert into public.pardons(id, recipient_name, pardon_date, enriched_at, is_public)
  values (501, 'Never checked, enriched', current_date - 400, now() - interval '1 day', true)`);

out('1. apply');
const r1 = await db.exec(M132);
const final = r1.at(-1).rows[0];
check(Object.keys(final)[0] === 'checked_backfilled', 'final check: first column is checked_backfilled');
check(Number(final.unchecked_enriched) === 0, 'final check: unchecked_enriched = 0');
check(final.anon_can_execute === false, 'final check: anon_can_execute = false');

out('2. backfill');
const stamps = Object.fromEntries((await db.query('select id, post_pardon_checked_at = enriched_at as same, post_pardon_checked_at is null as empty from public.pardons')).rows.map((r) => [r.id, r]));
check(stamps[101].same && stamps[201].same, 'checked_at backfilled from enriched_at');
check(stamps[402].empty, 'an unenriched pardon stays unchecked (NULL)');

out('3. due rule and exclusions');
// 501 was backfilled to "1 day ago", so it is not due; clear it to test never-checked-first.
await db.exec('update public.pardons set post_pardon_checked_at = null where id = 501');
const rows = await due(db);
const ids = rows.map((r) => Number(r.id));
check(JSON.stringify(ids) === JSON.stringify([501, 201, 203, 101, 301]),
  `order: never checked, then oldest check, then id (got ${ids.join(', ')})`);
check(!ids.includes(102), 'recent tier: checked 5 days ago is not due');
check(!ids.includes(202), 'older tier: checked 30 days ago is not due');
check(ids.includes(203), 'older tier: checked 61 days ago is due');
check(ids.includes(301), '179 days after the pardon is still the 14-day tier');
check(![401, 402, 403, 3].some((x) => ids.includes(x)), 'excluded: unpublished, unenriched, group card, id 3');
check(rows.every((r) => Number(r.pool_size) === 5), 'pool_size = due rows before LIMIT');
check('offense_raw' in rows[0] && 'case_number' in rows[0] && !('summary_neutral' in rows[0]), 'returns identity columns, not editorial ones');

out('4. limit clamp');
check((await due(db, 2)).length === 2 && Number((await due(db, 2))[0].pool_size) === 5, 'p_limit 2 returns 2 rows, pool_size still 5');
check((await due(db, 0)).length === 1, 'p_limit 0 clamps to 1');
await db.exec(`insert into public.pardons(id, recipient_name, pardon_date, enriched_at, is_public)
  select g, 'bulk ' || g, current_date - 400, now() - interval '100 days', true from generate_series(600, 619) g`);
check((await due(db, 50)).length === 10, 'p_limit 50 clamps to 10');
check((await db.query('select count(*)::int n from public.pardons_due_for_recheck(null)')).rows[0].n === 10, 'p_limit null defaults to 10');

out('5. a recheck stamp leaves the pool');
await db.exec('update public.pardons set post_pardon_checked_at = now() where id = 501');
check(!(await due(db)).map((r) => Number(r.id)).includes(501), 'stamped now = not due');

out('6. grants');
const priv = (role) => db.query(`select has_function_privilege('${role}', 'public.pardons_due_for_recheck(integer)', 'execute') as ok`).then((r) => r.rows[0].ok);
check(await priv('service_role') === true, 'service_role can execute');
check(await priv('anon') === false && await priv('authenticated') === false, 'anon and authenticated cannot');

out('7. idempotent re-run');
const before = (await db.query('select post_pardon_checked_at from public.pardons where id = 501')).rows[0].post_pardon_checked_at;
let err = null;
try { await db.exec(M132); } catch (e) { err = e.message; }
check(err === null, `re-run applies cleanly${err ? ': ' + err : ''}`);
const after = (await db.query('select post_pardon_checked_at from public.pardons where id = 501')).rows[0].post_pardon_checked_at;
check(String(before) === String(after), 're-run keeps a newer recheck stamp (backfill fills NULLs only)');

out(failures ? `pardons-recheck-sql-pglite: ${failures} FAILED` : 'pardons-recheck-sql-pglite: all checks passed');
process.exit(failures ? 1 : 0);
