// File: scripts/tests/concurrency-upsert.js
// Purpose: Prove atomic upsert+enqueue is race-safe and idempotent
// Usage: DATABASE_URL=postgres://... node scripts/tests/concurrency-upsert.js

import pg from 'pg';
import crypto from 'node:crypto';
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Set DATABASE_URL to your Postgres connection string.');
  process.exit(2);
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 5, idleTimeoutMillis: 30000 });

async function callUpsert(client, params) {
  const sql = `select * from upsert_article_and_enqueue($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`;
  const { rows } = await client.query(sql, params);
  return rows[0];
}

async function mainConcurrency() {
  const client = await pool.connect();
  try {
    const url = 'https://example.com/test-concurrency-article';
    const url_hash = 'concurrency-hash-' + Math.random().toString(36).slice(2); // keep unique per test run
    const headline = 'Concurrency Test Article';
    const source_name = 'TestSource';
    const source_domain = 'example.com';
    const published_at = new Date().toISOString();
    const content = 'hello world';
    const content_type = 'news_report';
    const opinion_flag = false;
    const metadata = {};

    const params = [url, url_hash, headline, source_name, source_domain, published_at, content, content_type, opinion_flag, metadata];

    // Fire 20 concurrent calls
    const calls = Array.from({ length: 20 }, () => callUpsert(client, params));
    const results = await Promise.allSettled(calls);

    const fulfilled = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    if (fulfilled.length === 0) throw new Error('All upserts failed');

    const articleId = fulfilled[0].article_id;

    // 1) Check that only one row exists for that (url_hash,published_date) key
    const { rows: artRows } = await client.query(
      `SELECT id, url_hash, published_date FROM articles WHERE url_hash = $1`,
      [url_hash]
    );

    if (artRows.length !== 1) {
      console.error('[FAIL] Expected 1 articles row, found', artRows.length);
      process.exit(1);
    }

    // 2) Check job_queue dedupe (one job for this article_id)
    const { rows: jqRows } = await client.query(
      `SELECT COUNT(*)::int AS c
         FROM job_queue
        WHERE job_type = 'process_article'
          AND payload->>'article_id' = $1`,
      [articleId]
    );

    console.log(`[OK] articles=1, process_article jobs=${jqRows[0].c}`);
    if (jqRows[0].c < 1 || jqRows[0].c > 1) {
      console.error('[FAIL] Expected exactly 1 job for article_id', articleId);
      process.exit(1);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

await mainConcurrency().catch(async (e) => {
  console.error('[FAIL]', e?.message || e);
  await pool.end();
  process.exit(1);
});
