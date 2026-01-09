#!/usr/bin/env node
/**
 * Backfill story enrichment for un-enriched stories.
 *
 * Usage: node scripts/enrich-stories-backfill.mjs --limit=100
 *
 * This script enriches stories that are missing AI summaries (summary_neutral = null).
 * It respects the daily budget cap and provides progress tracking.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { enrichStory } from './enrichment/enrich-stories-inline.js';

// Validate environment
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// CLI args
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '100');
const DRY_RUN = process.argv.includes('--dry-run');
const DAILY_BUDGET_LIMIT = 5.0; // $5/day cap

async function main() {
  console.log('='.repeat(60));
  console.log('STORY ENRICHMENT BACKFILL');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log(`Limit: ${LIMIT} stories`);
  console.log('');

  // 1. Check budget
  const today = new Date().toISOString().split('T')[0];
  const { data: budget, error: budgetError } = await supabase
    .from('budgets')
    .select('spent_usd')
    .eq('day', today)
    .single();

  if (budgetError && budgetError.code !== 'PGRST116') {
    // PGRST116 = no rows (first call of day)
    console.error('Budget check failed:', budgetError.message);
  }

  const spent = budget?.spent_usd || 0;
  console.log(`Budget: $${spent.toFixed(2)} / $${DAILY_BUDGET_LIMIT} (${(spent/DAILY_BUDGET_LIMIT*100).toFixed(0)}% used)`);

  if (spent >= DAILY_BUDGET_LIMIT) {
    console.log('');
    console.log('Daily budget exhausted. Run again tomorrow.');
    return;
  }

  const remaining = DAILY_BUDGET_LIMIT - spent;
  const maxAffordable = Math.floor(remaining / 0.003); // ~$0.003 per story
  console.log(`Remaining budget can enrich ~${maxAffordable} more stories today`);
  console.log('');

  // 2. Query un-enriched stories
  const { data: stories, error: queryError } = await supabase
    .from('stories')
    .select('id, primary_headline, last_enriched_at')
    .is('summary_neutral', null)
    .eq('status', 'active')
    .order('last_updated_at', { ascending: false })
    .limit(LIMIT);

  if (queryError) {
    console.error('Query failed:', queryError.message);
    process.exit(1);
  }

  console.log(`Found ${stories?.length || 0} un-enriched active stories`);
  console.log('');

  if (!stories || stories.length === 0) {
    console.log('Nothing to enrich. All stories are already enriched!');
    return;
  }

  if (DRY_RUN) {
    console.log('DRY RUN - would enrich these stories:');
    stories.slice(0, 10).forEach((s, i) => {
      console.log(`  ${i + 1}. [${s.id}] ${s.primary_headline?.slice(0, 60)}...`);
    });
    if (stories.length > 10) {
      console.log(`  ... and ${stories.length - 10} more`);
    }
    console.log('');
    console.log(`Estimated cost: $${(stories.length * 0.003).toFixed(2)}`);
    return;
  }

  // 3. Enrich with progress tracking
  let enriched = 0;
  let failed = 0;
  let totalCost = 0;
  const startTime = Date.now();

  console.log('Starting enrichment...');
  console.log('');

  for (const story of stories) {
    try {
      const result = await enrichStory(story, { supabase, openaiClient });
      enriched++;
      totalCost += result.cost;

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`[${enriched}/${stories.length}] Story ${story.id}: ${result.category} ($${result.cost.toFixed(4)}) [${elapsed}s]`);

    } catch (err) {
      failed++;
      console.error(`[FAIL] Story ${story.id}: ${err.message}`);
    }
  }

  // 4. Summary
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('');
  console.log('='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Enriched: ${enriched}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);
  console.log(`Time: ${totalTime}s`);
  console.log('');

  if (enriched > 0) {
    console.log('Stories should now display on the main page!');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
