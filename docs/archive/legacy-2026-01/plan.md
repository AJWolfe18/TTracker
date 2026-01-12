ready-to-copy: scripts/backfill-story-entities.js
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
const PAGE_SIZE = 200;          // how many story ids to fetch per page
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

async function fetchStoriesNeedingEntities(page = 0) {
  // top_entities is a text[] in your schema; treat NULL or length 0 as missing
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // Use RPC or direct query via PostgREST filter syntax
  const { data, error, count } = await sb
    .from('stories')
    .select('id, top_entities, lifecycle_state', { count: 'exact' })
    .in('lifecycle_state', WHERE_STATES)
    .or('top_entities.is.null,top_entities.cs.{"{}"}') // NULL or empty array
    .order('id', { ascending: true })
    .range(from, to);

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

  let page = 0;
  let total = 0;
  let processed = 0;
  let enqueued = 0;
  let deduped = 0;

  // prime total count
  {
    const { count } = await fetchStoriesNeedingEntities(0);
    total = count;
    console.log(`Found ~${total} stories missing entities.`);
  }

  while (true) {
    const { rows } = await fetchStoriesNeedingEntities(page);
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

    page += 1;
  }

  console.log(`Backfill complete. processed=${processed} enqueued=${enqueued} deduped=${deduped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

ready-to-copy: scripts/enrichment/prompts.js (story-level entities block)
/**
 * Add/merge this block into your story enrichment prompt module.
 * Goal: canonical entity IDs (text), consistent types, deterministic ordering.
 *
 * Entities spec (max 8):
 *  - id: canonical ID string (e.g., "US-TRUMP", "ORG-DOJ", "LOC-MISSOURI", "EVT-HOUSE-BILL-HR2")
 *  - name: display string
 *  - type: one of PERSON | ORG | LOCATION | EVENT
 *  - confidence: 0.0–1.0
 */

export const STORY_ENRICHMENT_SYSTEM = `
You are a precise political news enricher.
Return STRICT JSON only. No prose. Do not include markdown fences.
Use canonical entity IDs with stable prefixes:
- PERSON: US-<LASTNAME> (e.g., US-TRUMP, US-BIDEN, US-HALEY) — choose most recognized surname; include hyphenated if canonical.
- ORG: ORG-<CANONICAL_SNAKE> (e.g., ORG-DOJ, ORG-DHS, ORG-SUPREME-COURT, ORG-AP, ORG-NYT)
- LOCATION: LOC-<REGION> (e.g., LOC-USA, LOC-MISSOURI, LOC-TEJAS is invalid; use LOC-TEXAS)
- EVENT: EVT-<CANONICAL> (e.g., EVT-JAN6, EVT-IMPEACHMENT-2, EVT-HB-1234, EVT-EO-14067)

If you cannot confidently assign a canonical ID, omit that entity.
Prefer fewer, higher-confidence entities over many weak ones.
Keep the entity list diverse (avoid 8 PERSONs unless justified).
`;

export function buildStoryEnrichmentUser(story) {
  // story should include: title, summary (optional), concatenated text or key sentences
  const { title, lead, body } = story;
  const content = [title, lead, body].filter(Boolean).join('\n\n').slice(0, 6000);

  return `
TASK:
Analyze the story and produce a strict JSON object with the following keys:
- summary_neutral: 2–3 sentences, factual
- summary_spicy: 1–2 sentences, plain-English punchy
- category: one of your allowed categories (e.g., "Elections & Campaigns")
- severity: 1–5
- primary_actor: canonical ID or null
- entities: array of up to 8 entity objects as specified

TEXT:
${content}

OUTPUT JSON SHAPE:
{
  "summary_neutral": "...",
  "summary_spicy": "...",
  "category": "Elections & Campaigns",
  "severity": 3,
  "primary_actor": "US-TRUMP",
  "entities": [
    {"id":"US-TRUMP","name":"Donald Trump","type":"PERSON","confidence":0.96},
    {"id":"ORG-DOJ","name":"Department of Justice","type":"ORG","confidence":0.92},
    {"id":"LOC-MISSOURI","name":"Missouri","type":"LOCATION","confidence":0.88},
    {"id":"EVT-JAN6","name":"January 6 Capitol Attack","type":"EVENT","confidence":0.87}
  ]
}
Return ONLY the JSON object.`;
}

integration notes (concise)

In enrichStory(), keep top_entities as text[] (IDs only) and entity_counter as a JSON object mapping {id: count}. Use the helpers we discussed earlier (toTopEntities, buildEntityCounter).

Re-enrich stories when membership changes (merge/split/attach ≥N articles).

Backfill: run the script with DRY_RUN=1 first to validate counts, then without to enqueue jobs.