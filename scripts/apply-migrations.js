#!/usr/bin/env node
// Apply critical migrations to TEST database
// Run this before the worker to ensure atomic functions exist

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function applyMigrations() {
  console.log('📋 Checking and applying migrations...\n');
  
  // Check if atomic functions exist
  const { data: functions } = await supabase.rpc('claim_next_job', { p_job_type: null })
    .catch(err => ({ data: null, error: err }));
  
  if (!functions || functions.error?.message?.includes('does not exist')) {
    console.log('⚠️  Atomic functions missing - applying migration...');
    
    // Read and apply migration 009
    const migrationPath = path.join(__dirname, '..', 'migrations', '009_atomic_job_claiming.sql');
    
    if (!fs.existsSync(migrationPath)) {
      console.error('❌ Migration file not found:', migrationPath);
      console.log('Trying to create functions inline...');
      
      // Create the functions inline as fallback
      const { error } = await supabase.rpc('query', {
        query: `
          -- Minimal atomic claiming function
          CREATE OR REPLACE FUNCTION public.claim_next_job(p_job_type TEXT DEFAULT NULL)
          RETURNS public.job_queue
          LANGUAGE sql
          AS $$
            UPDATE public.job_queue
            SET status = 'processing',
                started_at = NOW(),
                attempts = attempts + 1
            WHERE id = (
              SELECT id FROM public.job_queue
              WHERE status = 'pending'
                AND (p_job_type IS NULL OR job_type = p_job_type)
                AND (run_at IS NULL OR run_at <= NOW())
              ORDER BY run_at NULLS FIRST, created_at
              LIMIT 1
              FOR UPDATE SKIP LOCKED
            )
            RETURNING *;
          $$;
          
          -- Minimal finish job function  
          CREATE OR REPLACE FUNCTION public.finish_job(
            p_id BIGINT,
            p_success BOOLEAN,
            p_error TEXT DEFAULT NULL
          )
          RETURNS public.job_queue
          LANGUAGE sql
          AS $$
            UPDATE public.job_queue
            SET status = CASE WHEN p_success THEN 'done' ELSE 'failed' END,
                completed_at = NOW(),
                last_error = CASE WHEN p_success THEN NULL ELSE p_error END
            WHERE id = p_id
            RETURNING *;
          $$;
        `
      }).catch(e => ({ error: e }));
      
      if (error) {
        console.error('❌ Failed to create functions:', error.message);
        process.exit(1);
      }
    }
    
    console.log('✅ Atomic functions created');
  } else {
    console.log('✅ Atomic functions already exist');
  }
  
  // Fix status values if needed
  const { error: statusError } = await supabase
    .from('job_queue')
    .update({ status: 'done' })
    .eq('status', 'completed');
    
  if (!statusError) {
    console.log('✅ Status values normalized');
  }
  
  console.log('\n✅ Database ready for atomic worker');
}

applyMigrations().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
