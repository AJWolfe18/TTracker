// Runs migrations/130_upsert_article_store_feed_id_metadata.sql (ADO-600) on PGlite (Postgres 17)
// against a minimal copy of PROD's articles + job_queue shape (feed_id TEXT, metadata JSONB '{}').
// Checks: 130 replaces the migration-121 function, new articles store feed_id + metadata (and still
// content), a re-upsert with an empty feed_id/metadata keeps the stored values, opinion_flag stays
// unwritten, a second run is a no-op, a TEST-style (032) function is left alone, a missing function
// raises.
// Not part of qa:smoke: @electric-sql/pglite is not a declared dependency, so the test SKIPS
// (exit 0) when it is missing. Run: node scripts/tests/ingest-rpc-130-pglite.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = (s) => process.stdout.write(`${s}\n`);

let PGlite, pgcrypto;
try {
  ({ PGlite } = await import(pathToFileURL(path.join(repo, 'node_modules/@electric-sql/pglite/dist/index.js')).href));
  ({ pgcrypto } = await import(pathToFileURL(path.join(repo, 'node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js')).href));
} catch {
  out('ingest-rpc-130-pglite: SKIP (@electric-sql/pglite not installed)');
  process.exit(0);
}

const M130 = fs.readFileSync(path.join(repo, 'migrations/130_upsert_article_store_feed_id_metadata.sql'), 'utf8');
const M121 = fs.readFileSync(path.join(repo, 'migrations/121_upsert_article_store_content.sql'), 'utf8');
// The function PROD runs today = 121's inner CREATE (between the $fn$ markers).
const FN121 = M121.split('$fn$')[1];

const SCHEMA = String.raw`
create extension if not exists pgcrypto;
create table public.articles(
  id text primary key, url text, url_hash text, title text, source_name text, source_domain text,
  published_at timestamptz, published_date date, excerpt text, content text,
  content_type text default 'news_report', opinion_flag boolean default false,
  feed_id text, metadata jsonb default '{}'::jsonb,
  created_at timestamptz, updated_at timestamptz,
  unique (url_hash, published_date));
create table public.job_queue(
  id bigserial primary key, job_type text, payload jsonb, run_at timestamptz, status text,
  payload_hash text generated always as (md5(payload::text)) stored,
  unique (job_type, payload_hash));
`;

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) out(`  ok   ${name}`);
  else { failures += 1; out(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`); }
};

async function fresh() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SCHEMA);
  return db;
}

async function runMigration(db) {
  const notices = [];
  const res = await db.exec(M130, { onNotice: (n) => notices.push(n.message) });
  const verify = res[res.length - 1].rows[0];
  return { notices, verify };
}

const upsert = (db, { url, title, content, feedId, metadata, opinion = false }) => db.query(
  `select public.upsert_article_and_enqueue_jobs($1, $2, $3, '2026-10-11T12:00:00Z'::timestamptz, $4, 'Politico', 'politico.com', 'news_report', $5, $6::jsonb) as r`,
  [url, title, content, feedId, opinion, metadata == null ? null : JSON.stringify(metadata)],
);
const row = async (db, url) => (await db.query('select feed_id, metadata, content, excerpt, opinion_flag, title from public.articles where url = $1', [url])).rows[0];

out('ingest-rpc-130-pglite');

// 1. PROD shape: the 121 function is installed, 130 replaces it.
{
  const db = await fresh();
  await db.exec(FN121);
  const { notices, verify } = await runMigration(db);
  check('130 applies over the 121 function', notices.some((n) => n.includes('now stores feed_id and metadata')), notices.join(' | '));
  check('verify query: stores_content and stores_feed_id_metadata', verify.stores_content === true && verify.stores_feed_id_metadata === true, JSON.stringify(verify));

  const meta = { author: 'A. Writer', feed_url: 'https://rss.politico.com/congress.xml', original_guid: 'g1' };
  const r1 = (await upsert(db, { url: 'https://x/1', title: 'T1', content: 'body '.repeat(200), feedId: '9', metadata: meta, opinion: true })).rows[0].r;
  const a1 = await row(db, 'https://x/1');
  check('new article: is_new and a cluster job', r1.is_new === true && r1.job_enqueued === true, JSON.stringify(r1));
  check('new article: feed_id stored as text', a1.feed_id === '9', String(a1.feed_id));
  check('new article: metadata stored', a1.metadata.author === 'A. Writer' && a1.metadata.original_guid === 'g1', JSON.stringify(a1.metadata));
  check('new article: content still stored (121 behavior kept)', a1.content.length === 1000 && a1.excerpt.length === 500);
  check('opinion_flag not written (deferred)', a1.opinion_flag === false, String(a1.opinion_flag));

  await upsert(db, { url: 'https://x/1', title: 'T1 updated', content: 'body', feedId: '', metadata: {} });
  const a1b = await row(db, 'https://x/1');
  check('re-upsert with empty feed_id keeps the stored one', a1b.feed_id === '9', String(a1b.feed_id));
  check('re-upsert with {} metadata keeps the stored one', a1b.metadata.author === 'A. Writer', JSON.stringify(a1b.metadata));
  check('re-upsert still updates the title', a1b.title === 'T1 updated', a1b.title);

  await upsert(db, { url: 'https://x/1', title: 'T1', content: 'body', feedId: '9', metadata: { author: 'B' } });
  check('re-upsert with new metadata replaces it', (await row(db, 'https://x/1')).metadata.author === 'B');

  await upsert(db, { url: 'https://x/2', title: 'T2', content: 'b', feedId: '4', metadata: null });
  const a2 = await row(db, 'https://x/2');
  check('null metadata stores {}', JSON.stringify(a2.metadata) === '{}', JSON.stringify(a2.metadata));

  const again = await runMigration(db);
  check('second run is a no-op', again.notices.some((n) => n.includes('skipped, nothing changed')), again.notices.join(' | '));
  check('second run: function still stores feed_id + metadata', again.verify.stores_feed_id_metadata === true);
}

// 2. TEST shape: a 032-style function (no 5,000-char cap) is left alone.
{
  const db = await fresh();
  await db.exec(String.raw`
CREATE FUNCTION public.upsert_article_and_enqueue_jobs(p_url text, p_title text, p_content text, p_published_at timestamptz, p_feed_id text, p_source_name text, p_source_domain text, p_content_type text DEFAULT 'news_report', p_is_opinion boolean DEFAULT false, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN /* 032: LEFT(p_content, 500), p_content, p_feed_id::bigint */ RETURN '{}'::jsonb; END $$;`);
  const { notices, verify } = await runMigration(db);
  check('TEST (032) function: skipped', notices.some((n) => n.includes('skipped, nothing changed')), notices.join(' | '));
  check('TEST (032) function: body untouched', verify.stores_feed_id_metadata === false && verify.stores_content === false);
}

// 3. No function at all: the migration raises instead of silently doing nothing.
{
  const db = await fresh();
  let msg = '';
  try { await db.exec(M130); } catch (e) { msg = e.message; }
  check('missing function raises', msg.includes('not found - nothing changed'), msg);
}

if (failures) { out(`ingest-rpc-130-pglite: ${failures} FAILED`); process.exit(1); }
out('ingest-rpc-130-pglite: all passed');
