#!/usr/bin/env node
/**
 * Enrich a single story by ID
 * Called by GitHub Actions workflow for on-demand re-enrichment
 *
 * Usage: node scripts/enrichment/enrich-single-story.js --story-id=123
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { enrichStory } from './enrich-stories-inline.js';

// Parse command line args
const args = process.argv.slice(2);
const storyIdArg = args.find(a => a.startsWith('--story-id='));

if (!storyIdArg) {
  console.error('Usage: node enrich-single-story.js --story-id=<id>');
  process.exit(1);
}

const storyId = parseInt(storyIdArg.split('=')[1], 10);

if (isNaN(storyId) || storyId <= 0) {
  console.error('Invalid story ID');
  process.exit(1);
}

// Environment validation
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!openaiKey) {
  console.error('Missing OPENAI_API_KEY');
  process.exit(1);
}

// Initialize clients
const supabase = createClient(supabaseUrl, supabaseKey);
const openaiClient = new OpenAI({ apiKey: openaiKey });

async function main() {
  console.log(`🔄 Enriching story ${storyId}...`);

  // Fetch the story
  const { data: story, error: fetchError } = await supabase
    .from('stories')
    .select('id, primary_headline, last_enriched_at')
    .eq('id', storyId)
    .single();

  if (fetchError || !story) {
    console.error(`❌ Story ${storyId} not found:`, fetchError?.message);
    process.exit(1);
  }

  console.log(`📰 Story: "${story.primary_headline?.slice(0, 60)}..."`);

  try {
    const result = await enrichStory(story, { supabase, openaiClient });

    console.log(`✅ Enriched story ${storyId}`);
    console.log(`   Category: ${result.category}`);
    console.log(`   Alarm Level: ${result.alarm_level}`);
    console.log(`   Cost: $${result.cost.toFixed(4)}`);
    console.log(`   Tokens: ${result.tokens.prompt_tokens} in, ${result.tokens.completion_tokens} out`);

    // Update budget tracking
    const today = new Date().toISOString().split('T')[0];
    await supabase.rpc('increment_budget', {
      p_day: today,
      p_cost: result.cost,
      p_calls: 1
    });

    console.log(`💰 Budget updated for ${today}`);

  } catch (err) {
    console.error(`❌ Enrichment failed:`, err.message);

    // Update failure count
    await supabase
      .from('stories')
      .update({
        enrichment_failure_count: story.enrichment_failure_count + 1,
        last_error_message: err.message?.slice(0, 500)
      })
      .eq('id', storyId);

    process.exit(1);
  }
}

main();
