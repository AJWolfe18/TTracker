#!/usr/bin/env node
// Minimal preflight check — trial RPC calls only, no schema catalog access

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const die = (m) => { console.error('❌', m); process.exit(1); };

(async () => {
  const host = (() => { try { return new URL(process.env.SUPABASE_URL).host; } catch { return 'unknown-host'; } })();
  console.log(`🔍 Running preflight checks against ${host}...\n`);

  // 1) enqueue_fetch_job signature OK?
  // Use a SAFE job_type the worker will not process (preflight_test) and delete if created.
  {
    const testHash = 'preflight-noop-' + Date.now();
    const { data, error } = await s.rpc('enqueue_fetch_job', {
      p_type: 'preflight_test',
      p_payload: { note: 'preflight' },
      p_hash: testHash
    });

    if (error && !/duplicate|unique|constraint/i.test(error.message)) {
      die(`enqueue_fetch_job failed: ${error.message}`);
    }
    // If it returned an id, clean up so we don't leave junk
    if (data) {
      await s.from('job_queue').delete().eq('id', data);
    }
    console.log('✅ enqueue_fetch_job RPC callable');
  }

  // 2) claim_and_start_job signature OK?
  // Use a NON-EXISTENT job type so it returns null without touching real jobs.
  {
    const { data, error } = await s.rpc('claim_and_start_job', { p_job_type: 'preflight_nonexistent_type' });
    if (error) die(`claim_and_start_job failed: ${error.message}`);
    if (data) {
      // Extremely unlikely, but if it did claim something, finish it to avoid stranding.
      await s.rpc('finish_job', {
        p_job_id: data.id,
        p_success: false,
        p_error_message: 'preflight abort'
      });
    }
    console.log('✅ claim_and_start_job RPC callable');
  }

  // 3) finish_job signature OK? Non-existent id should no-op without error.
  {
    const { error } = await s.rpc('finish_job', {
      p_job_id: -1,
      p_success: true,
      p_error_message: null
    });
    if (error) die(`finish_job failed: ${error.message}`);
    console.log('✅ finish_job RPC callable');
  }

  console.log('\n✅ Preflight OK: All RPC signatures callable');
  process.exit(0);
})().catch(e => die(e.message));
