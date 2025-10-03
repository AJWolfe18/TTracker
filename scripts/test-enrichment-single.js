// Test script for TTRC-189 - Story Enrichment Handler
// Tests enrichStory() on a single story to verify all fields update correctly

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testEnrichment() {
  console.log('🧪 Testing Story Enrichment Handler (TTRC-189)\n');

  // ========================================
  // 1. FIND A STORY TO TEST
  // ========================================
  console.log('📋 Step 1: Finding a story to enrich...');
  
  // Try to find a story that either:
  // - Has never been enriched (summary_neutral IS NULL)
  // - Was enriched >12 hours ago (outside cooldown window)
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  
  const { data: stories, error: storyError } = await supabase
    .from('stories')
    .select('id, primary_headline, last_enriched_at, summary_neutral')
    .eq('status', 'active')
    .or(`summary_neutral.is.null,last_enriched_at.lt.${twelveHoursAgo}`)
    .limit(1);

  if (storyError || !stories?.length) {
    console.error('❌ No testable stories found:', storyError?.message);
    console.log('\nℹ️  All stories may be within cooldown period (12 hours)');
    console.log('   or no stories exist. Try again later or create a test story.');
    process.exit(1);
  }

  const story = stories[0];
  console.log(`✅ Found story: ${story.id}`);
  console.log(`   Headline: ${story.primary_headline}`);
  console.log(`   Last enriched: ${story.last_enriched_at || 'Never'}`);
  console.log(`   Has summary: ${story.summary_neutral ? 'Yes' : 'No'}\n`);

  // ========================================
  // 2. VERIFY STORY HAS ARTICLES
  // ========================================
  console.log('📋 Step 2: Verifying story has articles...');
  
  const { data: articleLinks, error: linkError } = await supabase
    .from('article_story')
    .select('articles(*)')
    .eq('story_id', story.id);

  if (linkError || !articleLinks?.length) {
    console.error('❌ Story has no articles:', linkError?.message);
    console.log('\nℹ️  Story needs articles to generate summaries.');
    process.exit(1);
  }

  console.log(`✅ Story has ${articleLinks.length} article(s)\n`);

  // ========================================
  // 3. ENQUEUE ENRICHMENT JOB
  // ========================================
  console.log('📋 Step 3: Creating enrichment job...');
  
  const { data: job, error: jobError } = await supabase
    .from('job_queue')
    .insert({
      job_type: 'story.enrich',
      payload: { story_id: story.id },
      status: 'pending',
      run_at: new Date().toISOString()
    })
    .select()
    .single();

  if (jobError) {
    console.error('❌ Failed to create job:', jobError.message);
    process.exit(1);
  }

  console.log(`✅ Job created: ${job.id}`);
  console.log(`   Waiting for worker to process...\n`);

  // ========================================
  // 4. WAIT FOR JOB COMPLETION
  // ========================================
  console.log('⏳ Step 4: Monitoring job status...');
  
  let jobComplete = false;
  let attempts = 0;
  const maxAttempts = 60; // 60 seconds max
  
  while (!jobComplete && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;

    const { data: jobStatus } = await supabase
      .from('job_queue')
      .select('status, error')
      .eq('id', job.id)
      .single();

    if (!jobStatus) {
      console.error('❌ Lost track of job');
      process.exit(1);
    }

    if (jobStatus.status === 'completed') {
      console.log(`✅ Job completed after ${attempts} seconds\n`);
      jobComplete = true;
    } else if (jobStatus.status === 'failed') {
      console.error(`❌ Job failed: ${jobStatus.error}`);
      process.exit(1);
    } else if (attempts % 5 === 0) {
      console.log(`   Still waiting... (${attempts}s, status: ${jobStatus.status})`);
    }
  }

  if (!jobComplete) {
    console.error('❌ Job did not complete within 60 seconds');
    console.log('   Check worker logs for errors');
    process.exit(1);
  }

  // ========================================
  // 5. VERIFY STORY UPDATES
  // ========================================
  console.log('📋 Step 5: Verifying story updates...');
  
  const { data: updatedStory, error: verifyError } = await supabase
    .from('stories')
    .select('id, summary_neutral, summary_spicy, category, severity, primary_actor, last_enriched_at')
    .eq('id', story.id)
    .single();

  if (verifyError) {
    console.error('❌ Failed to fetch updated story:', verifyError.message);
    process.exit(1);
  }

  console.log('\n📊 ENRICHMENT RESULTS:\n');
  console.log('   Story ID:', updatedStory.id);
  console.log('   Last Enriched:', updatedStory.last_enriched_at);
  console.log('\n   ✓ Summary (Neutral):', updatedStory.summary_neutral ? 
    `${updatedStory.summary_neutral.substring(0, 100)}...` : '❌ MISSING');
  console.log('   ✓ Summary (Spicy):', updatedStory.summary_spicy ? 
    `${updatedStory.summary_spicy.substring(0, 100)}...` : '⚠️  Missing (fallback OK)');
  console.log('   ✓ Category:', updatedStory.category || '❌ MISSING');
  console.log('   ✓ Severity:', updatedStory.severity || '❌ MISSING');
  console.log('   ✓ Primary Actor:', updatedStory.primary_actor || '⚠️  None (nullable)');

  // ========================================
  // 6. VALIDATION
  // ========================================
  console.log('\n📋 Step 6: Validating results...\n');
  
  const validations = {
    'summary_neutral exists': !!updatedStory.summary_neutral,
    'summary_neutral length': updatedStory.summary_neutral?.split(' ').length >= 50,
    'category is valid': updatedStory.category && updatedStory.category !== 'other',
    'severity is valid': ['critical', 'severe', 'moderate', 'minor'].includes(updatedStory.severity),
    'last_enriched_at updated': !!updatedStory.last_enriched_at
  };

  let allValid = true;
  for (const [check, passed] of Object.entries(validations)) {
    console.log(`   ${passed ? '✅' : '❌'} ${check}`);
    if (!passed) allValid = false;
  }

  // ========================================
  // 7. COST ESTIMATE
  // ========================================
  console.log('\n💰 COST ESTIMATE:\n');
  console.log('   Per-story cost: ~$0.000405 (GPT-4o-mini)');
  console.log('   Token usage: ~150 input, ~200 output');
  console.log('   This test cost: <$0.001 (negligible)\n');

  // ========================================
  // 8. FINAL RESULT
  // ========================================
  if (allValid) {
    console.log('🎉 TEST PASSED!\n');
    console.log('   All required fields updated correctly.');
    console.log('   Ready to proceed with Phase 2 (TTRC-190).\n');
    process.exit(0);
  } else {
    console.log('❌ TEST FAILED!\n');
    console.log('   Some validations failed. Review handler implementation.\n');
    process.exit(1);
  }
}

// Run test
testEnrichment().catch(err => {
  console.error('💥 Test error:', err.message);
  process.exit(1);
});
