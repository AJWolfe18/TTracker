import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const payload = { article_id: 'idempotency-test-' + Date.now() };

// Try to enqueue same job 3 times
for (let i = 0; i < 3; i++) {
  const { error } = await sb.from('job_queue').upsert({
    job_type: 'story.cluster', 
    payload, 
    status: 'pending',
    run_at: new Date().toISOString()
  }, { 
    onConflict: 'job_type,payload_hash' 
  });
  assert.ifError(error);
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
