/**
 * Backfills story-level entities by enqueueing `story.enrich` for stories
 * where top_entities is NULL or empty. Batches with jitter to smooth spend.
 *
 * Usage:
 *   node scripts/backfill-story-entities.js             # defaults
 *   DRY_RUN=1 node scripts/backfill-story-entities.js   # don't write, just print
 *
 * Env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Requires:
 *   npm i @supabase/supabase-js dotenv
 */

import 'dotenv/config';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = !!process.env.DRY_RUN;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ------------ CONFIG ------------
const PAGE_SIZE = 500;          // how many story ids to fetch per page (keyset pagination)
const BATCH_SIZE = 25;          // how many jobs to enqueue per batch
const JITTER_MS = [250, 1750];  // random delay between jobs in a batch
const RUN_AT_OFFSET_SEC = 2;    // small delay for job run_at
const WHERE_STATES = ['emerging', 'growing', 'stable', 'stale']; // active-ish
// --------------------------------

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitterMs([min, max]) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function fetchStoriesNeedingEntities(lastId = null) {
  // Keyset pagination: fetch stories with NULL or empty top_entities
  // Server-side filter eliminates client-side filtering issues
  let q = sb
    .from('stories')
    .select('id, top_entities, lifecycle_state', { count: 'exact' })
    .in('lifecycle_state', WHERE_STATES)
    .or('top_entities.is.null,top_entities.eq.{}')  // NULL OR empty array
    .order('id', { ascending: true })
    .limit(PAGE_SIZE);

  if (lastId !== null) {
    q = q.gt('id', lastId);
  }

  const { data, error, count } = await q;
  if (error) throw error;

  return { rows: data ?? [], count: count ?? 0 };
}

async function enqueueStoryEnrich(storyId) {
  const payload = { story_id: storyId };
  const payloadHash = sha256Hex(JSON.stringify(payload));
  const runAt = new Date(Date.now() + RUN_AT_OFFSET_SEC * 1000).toISOString();

  if (DRY_RUN) {
    console.log('[DRY_RUN] enqueue story.enrich:', { storyId, payloadHash });
    return { id: null, status: 'dry_run' };
  }

  // Insert with dedupe on (job_type, payload_hash) WHERE processed_at IS NULL
  const { data, error } = await sb
    .from('job_queue')
    .insert({
      job_type: 'story.enrich',
      payload,
      payload_hash: payloadHash,
      status: 'pending',
      run_at: runAt,
      created_at: new Date().toISOString(),
    })
    .select('id')
    .limit(1)
    .single();

  if (error) {
    // Ignore unique conflicts quietly; log others
    const isConflict =
      String(error.message || '').toLowerCase().includes('duplicate') ||
      String(error.details || '').toLowerCase().includes('already exists') ||
      error.code === '23505';
    if (!isConflict) {
      console.warn('enqueue error', storyId, error);
    }
    return { id: null, status: isConflict ? 'deduped' : 'error' };
  }
  return { id: data?.id ?? null, status: 'enqueued' };
}

async function main() {
  console.log('Backfill: story entities → enqueue story.enrich');
  console.log(`Config: PAGE_SIZE=${PAGE_SIZE} BATCH_SIZE=${BATCH_SIZE} JITTER=${JITTER_MS[0]}-${JITTER_MS[1]}ms DRY_RUN=${DRY_RUN}`);

  let lastId = null;
  let total = null;
  let processed = 0;
  let enqueued = 0;
  let deduped = 0;

  while (true) {
    const { rows, count } = await fetchStoriesNeedingEntities(lastId);

    // Log total count on first fetch
    if (total === null && count !== null) {
      total = count;
      console.log(`Found ~${total} stories missing entities.`);
    }

    if (!rows.length) break;

    // batch in groups
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const results = [];
      for (const row of batch) {
        const r = await enqueueStoryEnrich(row.id);
        results.push(r);
        processed += 1;
        if (r.status === 'enqueued') enqueued += 1;
        if (r.status === 'deduped') deduped += 1;

        // jitter between job inserts to smooth spend
        await sleep(jitterMs(JITTER_MS));
      }

      const done = Math.min(processed, total || processed);
      console.log(
        `Batch done: enq=${results.filter(x => x.status==='enqueued').length} ` +
        `dedup=${results.filter(x => x.status==='deduped').length} ` +
        `err=${results.filter(x => x.status==='error').length} | ` +
        `progress ${done}/${total || '?'}`
      );
    }

    // Update lastId for next page (keyset pagination)
    lastId = rows[rows.length - 1].id;
  }

  console.log(`Backfill complete. processed=${processed} enqueued=${enqueued} deduped=${deduped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
