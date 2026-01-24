/*
 * Test script for spicy prompts (ADO-285: Test infrastructure fixes)
 * Runs enrichment on a few stories to verify the new angry tone
 *
 * Usage: node scripts/test-spicy-prompts.js [options]
 * Options:
 *   --limit=N     Number of stories to test (default: 3)
 *   --force       Bypass cooldown check (select any enriched stories)
 *   --dry-run     Show selected stories without running enrichment
 *   --prod        Use PROD database instead of TEST
 *
 * Examples:
 *   node scripts/test-spicy-prompts.js --limit=5 --force
 *   node scripts/test-spicy-prompts.js --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { enrichStory, ENRICHMENT_COOLDOWN_HOURS } from './enrichment/enrich-stories-inline.js';
import dotenv from 'dotenv';

dotenv.config();

// Parse CLI args
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace('--', '').split('=');
  acc[key] = val ?? true;
  return acc;
}, {});

const limit = args.limit ? parseInt(args.limit) : 3;
const forceMode = args.force === true;
const dryRun = args['dry-run'] === true;
const useProd = args.prod === true;

// Environment selection (ADO-285: default to TEST)
const supabaseUrl = useProd
  ? process.env.SUPABASE_URL
  : process.env.SUPABASE_TEST_URL || process.env.SUPABASE_URL;
const supabaseKey = useProd
  ? process.env.SUPABASE_SERVICE_ROLE_KEY
  : process.env.SUPABASE_TEST_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(`Missing Supabase credentials for ${useProd ? 'PROD' : 'TEST'}`);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * ADO-285: MCP/RLS sanity check - verify database connectivity and permissions
 * Runs basic queries to ensure we have proper access before proceeding
 */
async function checkDatabaseAccess() {
  console.log('🔑 Checking database access...');

  try {
    // Test 1: Basic read access to stories table
    const { data: storyCheck, error: storyError } = await supabase
      .from('stories')
      .select('id')
      .limit(1);

    if (storyError) {
      console.error(`   ❌ Cannot read stories table: ${storyError.message}`);
      console.error('   Check: Service key permissions, RLS policies, table exists');
      return false;
    }

    // Test 2: Write access - verified implicitly when enrichment runs
    // Note: Service key detection removed (JWT doesn't contain 'service' string)

    // Test 3: Check we can access article_story join (common failure point)
    const { error: joinError } = await supabase
      .from('article_story')
      .select('story_id')
      .limit(1);

    if (joinError) {
      console.warn(`   ⚠️ Cannot read article_story table: ${joinError.message}`);
      // Not fatal, but enrichment might have issues
    }

    console.log('   ✓ Database access verified\n');
    return true;

  } catch (err) {
    console.error(`   ❌ Database access check failed: ${err.message}`);
    return false;
  }
}

/**
 * ADO-285: Check job queue gate - ensure no conflicting enrichment jobs running
 * Narrows to story_enrich/story_cluster jobs, checks run_at <= now()
 */
async function checkJobQueueGate() {
  console.log('🔒 Checking job queue gate...');

  const now = new Date().toISOString();
  const { data: runningJobs, error } = await supabase
    .from('job_queue')
    .select('id, job_type, status, run_at')
    .in('job_type', ['story_enrich', 'story_cluster'])
    .or('status.eq.processing,status.eq.pending')
    .lte('run_at', now);

  if (error) {
    console.warn(`   ⚠️ Could not check job queue: ${error.message}`);
    return true; // Continue anyway, just warn
  }

  if (runningJobs && runningJobs.length > 0) {
    console.log(`   ⚠️ Found ${runningJobs.length} pending/running enrichment jobs:`);
    runningJobs.slice(0, 3).forEach(j => {
      console.log(`      - ${j.job_type} (${j.status})`);
    });
    console.log('   Consider waiting for jobs to complete for reliable test results.\n');
    return false; // Gate failed
  }

  console.log('   ✓ No conflicting enrichment jobs\n');
  return true;
}

/**
 * ADO-285: Get deterministic test cohort
 * With --force: any enriched stories
 * Without --force: only stories past cooldown period
 */
async function getTestCohort(targetCount) {
  console.log(`📋 Selecting test cohort (${forceMode ? 'FORCE mode' : 'respecting cooldown'})...`);

  // Calculate cooldown threshold
  const cooldownThreshold = new Date(Date.now() - ENRICHMENT_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from('stories')
    .select('id, primary_headline, summary_neutral, summary_spicy, last_enriched_at')
    .not('summary_neutral', 'is', null)
    .order('id', { ascending: false });

  // Apply cooldown filter unless --force is used
  if (!forceMode) {
    query = query.or(`last_enriched_at.is.null,last_enriched_at.lt.${cooldownThreshold}`);
  }

  const { data: stories, error } = await query.limit(targetCount);

  if (error) {
    throw new Error(`Failed to fetch test cohort: ${error.message}`);
  }

  return stories || [];
}

async function testSpicyPrompts() {
  const runStartedAt = new Date().toISOString();

  console.log('\n🌶️  TESTING SPICY PROMPTS\n');
  console.log('='.repeat(60));
  console.log(`RUN_START: ${runStartedAt}`);
  console.log(`Environment: ${useProd ? 'PROD' : 'TEST'}`);
  console.log(`Mode: ${forceMode ? 'FORCE (bypass cooldown)' : 'Normal (respect cooldown)'}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Limit: ${limit}\n`);

  // ADO-285: MCP/RLS sanity check first
  const accessOk = await checkDatabaseAccess();
  if (!accessOk) {
    console.error('❌ Database access check failed. Aborting.\n');
    process.exit(1);
  }

  // ADO-285: Check job queue gate
  const gateOk = await checkJobQueueGate();
  if (!gateOk && !forceMode) {
    console.log('💡 Use --force to run tests anyway\n');
  }

  // ADO-285: Get deterministic test cohort
  const stories = await getTestCohort(limit);

  if (!stories || stories.length === 0) {
    console.error('❌ No stories found for test cohort!');
    if (!forceMode) {
      console.error(`\n💡 All stories may have been enriched within cooldown period (${ENRICHMENT_COOLDOWN_HOURS}h).`);
      console.error('   Try: node scripts/test-spicy-prompts.js --force\n');
    }
    process.exit(1);
  }

  // Hard-fail if we can't get enough eligible stories (feedback: enforce exit codes)
  if (stories.length < limit && !forceMode) {
    console.error(`❌ Only found ${stories.length} cooldown-eligible stories (need ${limit})`);
    console.error('Wait for cooldown to expire or use --force to bypass');
    process.exit(1);
  }

  console.log(`✅ Selected ${stories.length} ${forceMode ? 'stories' : 'cooldown-eligible stories'}\n`);

  // ADO-285: Dry run mode - just show selection
  if (dryRun) {
    console.log('📋 DRY RUN - Selected stories:\n');
    stories.forEach((s, i) => {
      const lastEnriched = s.last_enriched_at
        ? `enriched ${Math.round((Date.now() - new Date(s.last_enriched_at)) / (1000 * 60 * 60))}h ago`
        : 'never enriched';
      console.log(`${i + 1}. [${s.id}] ${s.primary_headline?.substring(0, 50)}...`);
      console.log(`   ${lastEnriched}\n`);
    });
    console.log('Run without --dry-run to execute enrichment.\n');
    return;
  }

  let totalCost = 0;
  let successCount = 0;
  let failCount = 0;

  for (const story of stories) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📰 Story: ${story.primary_headline?.substring(0, 60)}...`);
    console.log(`   ID: ${story.id}`);

    // Show OLD summary for comparison
    console.log(`\n📋 OLD SPICY SUMMARY:`);
    console.log(story.summary_spicy || '(none)');

    try {
      // Re-enrich with new prompt
      const result = await enrichStory(story, { supabase, openaiClient });

      console.log(`\n🌶️  NEW SPICY SUMMARY:`);
      console.log(result.summary_spicy);

      console.log(`\n📊 Stats:`);
      console.log(`   Words: ~${result.summary_spicy?.split(/\s+/).length || 0}`);
      console.log(`   Cost: $${result.cost.toFixed(5)}`);
      console.log(`   Category: ${result.category}`);
      console.log(`   Severity: ${result.severity}`);

      totalCost += result.cost;
      successCount++;

    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
      failCount++;
    }

    // Small delay between stories
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 Results: ${successCount} enriched, ${failCount} failed`);
  console.log(`   Total cost: $${totalCost.toFixed(5)}`);

  // Hard-fail if not all enriched (feedback: enforce exit codes)
  if (successCount !== stories.length) {
    console.error(`\n❌ Expected ${stories.length} enriched, got ${successCount} - FAIL`);
    process.exit(1);
  }

  console.log(`\n✅ All ${stories.length} stories enriched successfully`);
  console.log(`\nCheck the summaries above - do they sound ANGRY and TRUTHFUL?`);
  console.log(`Look for: profanity, "YOUR taxes/rights", no "This is outrageous..."\n`);
}

// Run with parsed args
testSpicyPrompts().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
