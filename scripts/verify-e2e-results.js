#!/usr/bin/env node
// scripts/verify-e2e-results.js
// Smarter E2E verification – supabase-js v2 correct chaining

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Validate environment variables immediately
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const now = new Date();
const nowIso = now.toISOString();
const oneHourAgoIso = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

const getCount = async (table, build = (q) => q) => {
  const base = supabase.from(table).select('*', { count: 'exact', head: true });
  const { count, error } = await build(base);
  if (error) throw error;
  return count ?? 0;
};

async function main() {
  console.log('\n📊 E2E TEST RESULTS');
  console.log('════════════════════════════════════════');

  const feeds = await getCount('feed_registry', (q) => q.eq('is_active', true));
  
  // Count runnable jobs matching the exact claim predicate
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  
  // Pending jobs that are runnable (matches SQL exactly)
  const pendingRunnable = await getCount('job_queue', (q) =>
    q.eq('job_type', 'fetch_feed')
     .eq('status', 'pending')
     .is('processed_at', null)
     .or(`run_at.is.null,run_at.lte.${nowIso}`)
     .or('max_attempts.is.null,attempts.lt.max_attempts')
  );
  
  // Stale processing jobs (older than 5 minutes, matches SQL exactly)
  const staleProcessing = await getCount('job_queue', (q) =>
    q.eq('job_type', 'fetch_feed')
     .eq('status', 'processing')
     .is('processed_at', null)
     .lt('started_at', fiveMinutesAgo)
     .or(`run_at.is.null,run_at.lte.${nowIso}`)
     .or('max_attempts.is.null,attempts.lt.max_attempts')
  );
  
  const runnable = pendingRunnable + staleProcessing;
  
  // All processing jobs (for monitoring)
  const processing = await getCount('job_queue', (q) =>
    q.eq('job_type', 'fetch_feed').eq('status', 'processing')
  );
  const articles1h = await getCount('articles', (q) =>
    q.gte('created_at', oneHourAgoIso)
  );
  const totalStories = await getCount('stories');

  // Job status (last hour) for context
  const statusCounts = {};
  {
    const { data } = await supabase
      .from('job_queue')
      .select('status')
      .gte('created_at', oneHourAgoIso);
    data?.forEach((j) => {
      statusCounts[j.status] = (statusCounts[j.status] || 0) + 1;
    });
  }

  console.log(`Active feeds: ${feeds}`);
  console.log(`Runnable jobs: ${runnable}`);
  console.log(`Processing jobs: ${processing}`);
  console.log(`Articles (last hour): ${articles1h}`);
  console.log(`Total stories: ${totalStories}`);

  console.log('\nJob Queue Status (last hour):');
  Object.entries(statusCounts).forEach(([status, cnt]) => {
    const emoji =
      status === 'done' ? '✅' :
      status === 'failed' ? '❌' :
      status === 'processing' ? '⚙️' :
      status === 'pending' ? '⏳' : '🔄';
    console.log(`  ${emoji} ${status}: ${cnt}`);
  });

  const report = {
    timestamp: nowIso,
    environment: 'TEST',
    metrics: { feeds, runnable, processing, articles1h, totalStories, jobStatusLastHour: statusCounts },
    success: true,
    reason: 'Pipeline functioning normally',
  };

  // Smart failure: only fail if feeds>0 AND no runnable AND no processing AND no new articles
  if (feeds > 0 && runnable === 0 && processing === 0 && articles1h === 0) {
    report.success = false;
    report.reason = 'Pipeline stuck: No runnable/processing jobs and no new articles';
    console.error('\n❌ E2E TEST FAILED - Pipeline appears stuck');
  } else if (articles1h === 0) {
    report.success = true;
    report.reason = 'No new articles (feeds may already be current)';
    console.warn('\n⚠️  E2E TEST WARNING - No new articles; may be normal');
  } else {
    console.log('\n✅ E2E TEST PASSED');
  }

  fs.writeFileSync('e2e-test-report.json', JSON.stringify(report, null, 2));
  console.log('\n📝 Report saved to e2e-test-report.json');

  process.exit(report.success ? 0 : 1);
}

main().catch((err) => {
  console.error('Error running E2E verification:', err);
  // ensure CI still uploads a report file for debugging
  fs.writeFileSync('e2e-test-report.json', JSON.stringify({ 
    success: false, 
    error: String(err),
    message: err.message,
    timestamp: nowIso 
  }, null, 2));
  process.exit(1);
});
