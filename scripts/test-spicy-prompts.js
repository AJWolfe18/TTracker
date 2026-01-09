/*
 * Test script for spicy prompts
 * Runs enrichment on a few stories to verify the new angry tone
 *
 * Usage: node scripts/test-spicy-prompts.js [limit]
 * Default: 3 stories
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { enrichStory } from './enrichment/enrich-stories-inline.js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function testSpicyPrompts(limit = 3) {
  console.log('\n🌶️  TESTING SPICY PROMPTS\n');
  console.log('=' .repeat(60));

  // Get stories that have been enriched before (so we can compare)
  const { data: stories, error } = await supabase
    .from('stories')
    .select('id, primary_headline, summary_neutral, summary_spicy')
    .not('summary_neutral', 'is', null)
    .order('id', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching stories:', error.message);
    return;
  }

  console.log(`Found ${stories.length} stories to re-enrich\n`);

  let totalCost = 0;

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

    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
    }

    // Small delay between stories
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ Test complete!`);
  console.log(`   Stories processed: ${stories.length}`);
  console.log(`   Total cost: $${totalCost.toFixed(5)}`);
  console.log(`\nCheck the summaries above - do they sound ANGRY and TRUTHFUL?`);
  console.log(`Look for: profanity, "YOUR taxes/rights", no "This is outrageous..."\n`);
}

// Run with optional limit from command line
const limit = parseInt(process.argv[2], 10) || 3;
testSpicyPrompts(limit);
