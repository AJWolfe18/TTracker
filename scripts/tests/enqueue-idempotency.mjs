import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const payload = { article_id: 'idempotency-test-' + Date.now() };

// Try to enqueue same job 3 times using the RPC function
// The RPC handles deduplication via ON CONFLICT with partial unique index
// payload_hash is auto-generated (GENERATED ALWAYS column), so we don't pass it
for (let i = 0; i < 3; i++) {
  const { data, error } = await sb.rpc('enqueue_fetch_job', {
    p_type: 'story.cluster',
    p_payload: payload
  });
  assert.ifError(error);
  // First call returns job ID, subsequent calls return NULL (duplicate ignored)
  if (i === 0) {
    assert.ok(data !== null, 'First enqueue should return job ID');
  } else {
    assert.ok(data === null, `Call ${i+1} should return NULL (duplicate)`);
  }
}

// Verify only 1 job was created
const { data, error } = await sb.from('job_queue')
  .select('id')
  .eq('job_type', 'story.cluster')
  .contains('payload', payload)
  .gte('created_at', new Date(Date.now() - 60_000).toISOString());

assert.ifError(error);
assert.ok(data.length === 1, `expected 1 row, got ${data.length}`);

console.log('[OK] enqueue-idempotency');
