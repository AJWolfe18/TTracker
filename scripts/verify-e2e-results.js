#!/usr/bin/env node
// Verify RSS E2E test results
// Check if articles were created and generate report

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyResults() {
  console.log('\n📊 E2E TEST RESULTS');
  console.log('═'.repeat(40));
  
  // Check articles created in last hour
  const cutoff = new Date(Date.now() - 3600000).toISOString();
  const { data: articles, count, error } = await supabase
    .from('articles')
    .select('*', { count: 'exact' })
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (error) {
    console.error('❌ Failed to query articles:', error.message);
    process.exit(1);
  }
  
  console.log(`Articles created in last hour: ${count || 0}`);
  
  if (articles && articles.length > 0) {
    console.log('\nSample articles:');
    articles.slice(0, 5).forEach(a => {
      const title = (a.title || '').substring(0, 60);
      console.log(`  - [${a.source_name}] ${title}...`);
    });
  }
  
  // Check job queue status
  const { data: jobStats } = await supabase
    .from('job_queue')
    .select('status, job_type');
    
  const statusCounts = {};
  const typeCounts = {};
  
  jobStats?.forEach(job => {
    statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;
    typeCounts[job.job_type] = (typeCounts[job.job_type] || 0) + 1;
  });
  
  console.log('\nJob Queue Status:');
  Object.entries(statusCounts).forEach(([status, cnt]) => {
    const icon = status === 'pending' ? '⏳' :
                 status === 'processing' ? '⚙️' :
                 status === 'done' ? '✅' :
                 status === 'failed' ? '❌' : '🔄';
    console.log(`  ${icon} ${status}: ${cnt}`);
  });
  
  // Check stories
  const { count: storyCount } = await supabase
    .from('stories')
    .select('*', { count: 'exact', head: true });
    
  console.log(`\nTotal stories: ${storyCount || 0}`);
  
  // Generate report
  const report = {
    timestamp: new Date().toISOString(),
    environment: 'TEST',
    success: count > 0,
    metrics: {
      articles_created_1h: count || 0,
      total_stories: storyCount || 0,
      job_status: statusCounts,
      job_types: typeCounts
    },
    sample_articles: articles?.slice(0, 5).map(a => ({
      title: a.title,
      source: a.source_name,
      created: a.created_at
    }))
  };
  
  // Save report
  fs.writeFileSync('e2e-test-report.json', JSON.stringify(report, null, 2));
  console.log('\n📝 Report saved to e2e-test-report.json');
  
  // Final verdict
  if (count > 0) {
    console.log('\n✅ E2E TEST PASSED - Articles are being ingested!');
    process.exit(0);
  } else {
    console.log('\n❌ E2E TEST FAILED - No articles created');
    console.log('   Check the worker logs for errors');
    process.exit(1);  // Fail the CI
  }
}

verifyResults().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
