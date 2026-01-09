// Check RSS Pipeline Status - What's Actually Working?
// This script verifies each stage of the RSS → Articles → Stories → Summaries pipeline

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('🔍 RSS PIPELINE STATUS CHECK\n');
console.log('='.repeat(80));

async function checkPipelineStatus() {
  try {
    // 1. CHECK FEED REGISTRY
    console.log('\n📡 1. FEED REGISTRY STATUS:');
    const { data: feeds, error: feedError } = await supabase
      .from('feed_registry')
      .select('*')
      .order('created_at', { ascending: false });

    if (feedError) {
      console.log('❌ Error reading feed_registry:', feedError.message);
    } else {
      console.log(`✅ ${feeds.length} feeds registered`);
      feeds.forEach(feed => {
        console.log(`   - ${feed.source_name}: ${feed.is_active ? '🟢 Active' : '🔴 Inactive'} | Last fetched: ${feed.last_fetched_at || 'Never'}`);
      });
    }

    // 2. CHECK ARTICLES TABLE
    console.log('\n📰 2. ARTICLES TABLE STATUS:');
    const { data: recentArticles, error: articlesError } = await supabase
      .from('articles')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    const { count: totalArticles } = await supabase
      .from('articles')
      .select('*', { count: 'exact', head: true });

    if (articlesError) {
      console.log('❌ Error reading articles:', articlesError.message);
    } else {
      console.log(`✅ ${totalArticles} total articles in database`);
      if (recentArticles.length > 0) {
        console.log('   Latest articles:');
        recentArticles.forEach(article => {
          const date = new Date(article.created_at).toLocaleString();
          console.log(`   - [${date}] ${article.title?.substring(0, 60)}... (${article.source_name})`);
        });
      } else {
        console.log('   ⚠️  No articles found');
      }
    }

    // 3. CHECK STORIES TABLE
    console.log('\n📚 3. STORIES TABLE STATUS:');
    const { data: stories, error: storiesError } = await supabase
      .from('stories')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    const { count: totalStories } = await supabase
      .from('stories')
      .select('*', { count: 'exact', head: true });

    if (storiesError) {
      console.log('❌ Error reading stories:', storiesError.message);
    } else if (totalStories === 0) {
      console.log('⚠️  No stories created yet (Clustering not implemented)');
    } else {
      console.log(`✅ ${totalStories} stories created`);
      stories.forEach(story => {
        console.log(`   - Story ${story.id}: ${story.primary_headline?.substring(0, 50)}...`);
        console.log(`     Status: ${story.status} | Articles: ${story.article_count}`);
      });
    }

    // 4. CHECK JOB QUEUE
    console.log('\n⚙️  4. JOB QUEUE STATUS:');
    const { data: pendingJobs, error: jobsError } = await supabase
      .from('job_queue')
      .select('*')
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false });

    const { data: recentJobs } = await supabase
      .from('job_queue')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    if (jobsError) {
      console.log('❌ Error reading job_queue:', jobsError.message);
    } else {
      console.log(`📊 Queue stats:`);
      console.log(`   - Pending/Processing: ${pendingJobs.length} jobs`);
      
      // Count by job type
      const jobTypes = {};
      recentJobs.forEach(job => {
        jobTypes[job.job_type] = (jobTypes[job.job_type] || 0) + 1;
      });
      
      console.log('   Recent job types:');
      Object.entries(jobTypes).forEach(([type, count]) => {
        console.log(`   - ${type}: ${count} jobs`);
      });
    }

    // 5. CHECK POLITICAL_ENTRIES (old table)
    console.log('\n📊 5. POLITICAL_ENTRIES (old system):');
    const { count: politicalCount } = await supabase
      .from('political_entries')
      .select('*', { count: 'exact', head: true });

    console.log(`   - ${politicalCount || 0} entries in old table`);

    // 6. PIPELINE FLOW SUMMARY
    console.log('\n' + '='.repeat(80));
    console.log('📈 PIPELINE FLOW SUMMARY:\n');
    
    console.log('Current Data Flow:');
    console.log('1. RSS Feeds → ✅ WORKING (feeds registered)');
    console.log(`2. Fetch Articles → ${totalArticles > 0 ? '✅ WORKING' : '❌ NOT WORKING'} (${totalArticles} articles)`);
    console.log(`3. Create Stories → ${totalStories > 0 ? '✅ WORKING' : '❌ NOT YET - Clustering not implemented'} (${totalStories} stories)`);
    console.log('4. Generate Summaries → ❌ NOT YET - Requires stories first');
    console.log('5. Enrichment → ⚠️  READY - OpenAI configured but needs articles');

    // 7. WHAT'S MISSING
    console.log('\n🚧 WHAT NEEDS TO BE BUILT:');
    console.log('');
    console.log('TTRC-142 (Clustering Algorithm):');
    console.log('  - Group similar articles into stories');
    console.log('  - Match new articles to existing stories');
    console.log('  - Create story records with primary headlines');
    console.log('');
    console.log('TTRC-143 (Story Lifecycle):');
    console.log('  - Auto-close old stories after 72 hours');
    console.log('  - Archive stories to keep active list fresh');
    console.log('');
    console.log('TTRC-148 (Enrichment):');
    console.log('  - Generate neutral/spicy summaries via OpenAI');
    console.log('  - Extract entities and key topics');
    console.log('  - Calculate importance scores');

    // 8. NEXT STEPS
    console.log('\n' + '='.repeat(80));
    console.log('🎯 RECOMMENDED NEXT STEPS:\n');
    
    if (totalArticles === 0) {
      console.log('1. ⚠️  No articles found - Check if RSS fetcher is running');
      console.log('   - Run: NODE_ENV=test node scripts/job-queue-worker.js');
      console.log('   - Or trigger GitHub Actions workflow');
    } else if (totalStories === 0) {
      console.log('1. ✅ Articles are flowing in');
      console.log('2. 🎯 NEXT: Implement TTRC-142 (Clustering) to create stories');
      console.log('   - This will group articles into stories');
      console.log('   - Then summaries can be generated');
    } else {
      console.log('1. ✅ Full pipeline appears operational!');
      console.log('2. Monitor for quality and performance');
    }

  } catch (error) {
    console.error('❌ Fatal error:', error.message);
  }
}

// Run the check
checkPipelineStatus();
