#!/usr/bin/env node
// scripts/verify-e2e-results.js
// Smarter E2E verification – fail only on true pipeline faults

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const now = new Date();
const oneHourAgoIso = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
const nowIso = now.toISOString();

const getCount = async (q) => {
  const { count, error } = await q.select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
};

async function main() {
  console.log('\n📊 E2E TEST RESULTS');
  console.log('════════════════════════════════════════');

  const feeds = await getCount(
    supabase.from('feed_registry').eq('is_active', true)
  );

  const runnable = await getCount(
    supabase.from('job_queue')
      .eq('job_type', 'fetch_feed')
      .is('processed_at', null)
      .lte('run_at', nowIso)
  );

  const processing = await getCount(
    supabase.from('job_queue')
      .eq('job_type', 'fetch_feed')
      .eq('status', 'processing')
  );

  const articles1h = await getCount(
    supabase.from('articles')
      .gte('created_at', oneHourAgoIso)
  );

  const { count: totalStories } = await supabase
    .from('stories')
    .select('*', { count: 'exact', head: true });

  // Job status (last hour) for context
  const statusCounts = {};
  const { data: jobStats } = await supabase
    .from('job_queue')
    .select('status')
    .gte('created_at', oneHourAgoIso);

  jobStats?.forEach(j => {
    statusCounts[j.status] = (statusCounts[j.status] || 0) + 1;
  });

  console.log(`Active feeds: ${feeds}`);
  console.log(`Runnable jobs: ${runnable}`);
  console.log(`Processing jobs: ${processing}`);
  console.log(`Articles (last hour): ${articles1h}`);
  console.log(`Total stories: ${totalStories || 0}`);

  console.log('\nJob Queue Status (last hour):');
  Object.entries(statusCounts).forEach(([status, cnt]) => {
    const emoji = status === 'done' ? '✅'
                : status === 'failed' ? '❌'
                : status === 'processing' ? '⚙️'
                : status === 'pending' ? '⏳'
                : '🔄';
    console.log(`  ${emoji} ${status}: ${cnt}`);
  });

  // Build report
  const report = {
    timestamp: nowIso,
    environment: 'TEST',
    metrics: {
      feeds,
      runnable,
      processing,
      articles1h,
      totalStories: totalStories || 0,
      jobStatusLastHour: statusCounts
    },
    success: true,
    reason: 'Pipeline functioning normally'
  };

  // Smart failure detection:
  // Fail only if feeds exist AND no runnable AND no processing AND no new articles
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

main().catch(err => {
  console.error('Error running E2E verification:', err);
  process.exit(1);
});
