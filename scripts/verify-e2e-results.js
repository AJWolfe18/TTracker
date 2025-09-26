#!/usr/bin/env node
// Smarter E2E verification - only fails on true pipeline problems
// Senior dev approved version

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const nowIso = new Date().toISOString();
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

// Helper to get count
const getCount = async (query) => {
  const result = await query.select('*', { count: 'exact', head: true });
  return result.count ?? 0;
};

async function verifyE2EResults() {
  console.log('📊 E2E TEST RESULTS');
  console.log('════════════════════════════════════════');
  
  // Get metrics
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
      .gte('created_at', oneHourAgo)
  );
  
  // Get job queue status breakdown
  const { data: jobStats } = await supabase
    .from('job_queue')
    .select('status')
    .gte('created_at', oneHourAgo);
    
  const statusCounts = {};
  if (jobStats) {
    jobStats.forEach(job => {
      statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;
    });
  }
  
  // Get total stories
  const { count: totalStories } = await supabase
    .from('stories')
    .select('*', { count: 'exact', head: true });
  
  // Print results
  console.log(`Active feeds: ${feeds}`);
  console.log(`Runnable jobs: ${runnable}`);
  console.log(`Processing jobs: ${processing}`);
  console.log(`Articles (last hour): ${articles1h}`);
  console.log(`Total stories: ${totalStories || 0}`);
  
  console.log('\nJob Queue Status (last hour):');
  Object.entries(statusCounts).forEach(([status, count]) => {
    const emoji = status === 'done' ? '✅' : status === 'failed' ? '❌' : '⏳';
    console.log(` ${emoji} ${status}: ${count}`);
  });
  
  // Create report
  const report = {
    timestamp: new Date().toISOString(),
    metrics: {
      feeds,
      runnable,
      processing,
      articles1h,
      totalStories: totalStories || 0
    },
    jobStats: statusCounts,
    success: false,
    reason: null
  };
  
  // Smart failure detection
  // Only fail if: feeds exist AND no runnable AND no processing AND no new articles
  if (feeds > 0 && runnable === 0 && processing === 0 && articles1h === 0) {
    report.success = false;
    report.reason = 'Pipeline stuck: No runnable/processing jobs and no new articles';
    console.error('\n❌ E2E TEST FAILED - Pipeline appears stuck');
    console.log('   No runnable or processing jobs, and no articles created');
  } else if (articles1h === 0) {
    // Warning but not failure - feeds might be current
    report.success = true;
    report.reason = 'No new articles (feeds may be current)';
    console.log('\n⚠️ E2E TEST WARNING - No new articles');
    console.log('   This may be normal if feeds were already up-to-date');
  } else {
    report.success = true;
    report.reason = 'Pipeline functioning normally';
    console.log('\n✅ E2E TEST PASSED');
    console.log(`   ${articles1h} articles created in last hour`);
  }
  
  // Save report
  fs.writeFileSync('e2e-test-report.json', JSON.stringify(report, null, 2));
  console.log('\n📝 Report saved to e2e-test-report.json');
  
  // Exit with appropriate code
  process.exit(report.success ? 0 : 1);
}

verifyE2EResults().catch(err => {
  console.error('Error running E2E verification:', err);
  process.exit(1);
});
