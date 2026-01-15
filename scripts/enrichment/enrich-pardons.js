#!/usr/bin/env node

/**
 * Pardon GPT Enrichment Script (ADO-246)
 *
 * Transforms Perplexity research data into reader-facing copy using GPT-4o-mini.
 * Sets is_public=true on successful enrichment.
 *
 * Usage:
 *   node scripts/enrichment/enrich-pardons.js [options]
 *
 * Options:
 *   --dry-run     Preview without DB writes
 *   --force       Re-enrich even if already enriched
 *   --limit=N     Max pardons to process (default: 20)
 *   --id=N        Enrich specific pardon ID only
 *
 * Environment:
 *   SUPABASE_URL / SUPABASE_TEST_URL            - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY / SUPABASE_TEST_SERVICE_KEY - Service role key (bypasses RLS)
 *   OPENAI_API_KEY          - OpenAI API key
 *   RUN_ID                  - GitHub Actions run ID (optional)
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

import { SYSTEM_PROMPT, buildUserPrompt, validateEnrichmentResponse } from './pardons-gpt-prompt.js';
import { getPoolType, selectVariation, buildVariationInjection } from './pardons-variation-pools.js';

// ============================================================================
// Constants
// ============================================================================

const PROMPT_VERSION = '1.0';
const MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 600;
const TEMPERATURE = 0.7;
const BATCH_SIZE = 20;
const DELAY_BETWEEN_MS = 1000; // 1 second between API calls

// GPT-4o-mini pricing (as of 2024)
const INPUT_COST_PER_1K = 0.00015;
const OUTPUT_COST_PER_1K = 0.0006;

// Daily budget cap (shares with stories enrichment)
const DAILY_BUDGET_CAP_USD = 5.0;

// ============================================================================
// Supabase Client
// ============================================================================

function createSupabaseClient() {
  // Prioritize TEST environment (pardons feature is test-only for now)
  const url = process.env.SUPABASE_TEST_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_TEST_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (also checked _TEST_ variants)');
  }

  return createClient(url, key, {
    auth: { persistSession: false }
  });
}

// ============================================================================
// OpenAI Client
// ============================================================================

function createOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY');
  }

  return new OpenAI({ apiKey });
}

// ============================================================================
// Budget Check
// ============================================================================

async function checkDailyBudget(supabase) {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('budgets')
    .select('spent_usd')
    .eq('day', today)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
    // Warn but proceed - budget tracking shouldn't block enrichment
    console.warn('   Budget check warning:', error.message);
    console.warn('   Proceeding without budget tracking (table may not exist)');
    return { ok: true, spent: 0, remaining: DAILY_BUDGET_CAP_USD };
  }

  const spent = data?.spent_usd || 0;
  const remaining = DAILY_BUDGET_CAP_USD - spent;

  return {
    ok: remaining > 0.10, // Need at least $0.10 to proceed
    spent,
    remaining
  };
}

// ============================================================================
// Update Daily Budget
// ============================================================================

async function updateDailyBudget(supabase, cost) {
  const today = new Date().toISOString().split('T')[0];

  // Upsert pattern: increment spent_usd
  const { error } = await supabase.rpc('increment_budget', {
    p_day: today,
    p_amount: cost
  });

  if (error) {
    // Fallback: try direct upsert if RPC doesn't exist
    console.warn('   Budget RPC failed, using direct update:', error.message);

    const { data: existing } = await supabase
      .from('budgets')
      .select('spent_usd, openai_calls')
      .eq('day', today)
      .single();

    if (existing) {
      await supabase
        .from('budgets')
        .update({
          spent_usd: (existing.spent_usd || 0) + cost,
          openai_calls: (existing.openai_calls || 0) + 1
        })
        .eq('day', today);
    } else {
      await supabase
        .from('budgets')
        .insert({
          day: today,
          spent_usd: cost,
          openai_calls: 1
        });
    }
  }
}

// ============================================================================
// Pardon Enrichment Worker
// ============================================================================

class PardonEnrichmentWorker {
  constructor({ supabase, openai, dryRun = false, force = false, runId = null }) {
    this.supabase = supabase;
    this.openai = openai;
    this.dryRun = dryRun;
    this.force = force;
    this.runId = runId;
    this.recentOpeningIds = [];
    this.recentOpeningTexts = [];

    this.stats = {
      processed: 0,
      enriched: 0,
      skipped: 0,
      errors: 0,
      totalCost: 0,
      costTrackingFailures: 0,
      untrackedCost: 0
    };
  }

  /**
   * Get pardons that need enrichment
   */
  async getPendingPardons(limit, specificId = null) {
    // Note: enrichment_prompt_version column requires migration 060
    // Using core columns only for compatibility before migration
    let query = this.supabase
      .from('pardons')
      .select(`
        id, recipient_name, recipient_type, recipient_count, recipient_criteria,
        pardon_date, clemency_type, offense_raw, conviction_district, crime_category,
        primary_connection_type, secondary_connection_types, corruption_level,
        corruption_reasoning, trump_connection_detail, donation_amount_usd,
        receipts_timeline, pardon_advocates, enriched_at
      `)
      .eq('research_status', 'complete');

    if (specificId) {
      query = query.eq('id', specificId);
    } else if (!this.force) {
      // Only get unenriched (enriched_at IS NULL)
      // Full idempotency via enrichment_prompt_version requires migration 060
      query = query.is('enriched_at', null);
    }

    query = query.order('pardon_date', { ascending: false }).limit(limit);

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch pardons: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Enrich a single pardon
   */
  async enrichPardon(pardon) {
    const { id, recipient_name, corruption_level, primary_connection_type } = pardon;

    console.log(`\n   Processing: ${recipient_name} (ID: ${id})`);

    try {
      // 1. Select variation for anti-repetition
      const poolType = getPoolType(corruption_level, primary_connection_type);
      const variation = selectVariation(poolType, this.recentOpeningIds);
      const variationInjection = buildVariationInjection(variation, this.recentOpeningTexts);

      // Track the variation used
      this.recentOpeningIds.push(variation.opening.id);
      if (this.recentOpeningIds.length > 10) this.recentOpeningIds.shift();

      // 2. Build prompt
      const userPrompt = buildUserPrompt(pardon, variationInjection);

      if (this.dryRun) {
        console.log(`   [DRY RUN] Would call GPT with ${userPrompt.length} char prompt`);
        console.log(`   Pool type: ${poolType}, Opening: ${variation.opening.id}`);
        return { success: true, dryRun: true };
      }

      // 3. Call OpenAI
      const completion = await this.openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE
      });

      // 4. Parse and validate response
      const text = completion.choices?.[0]?.message?.content || '{}';
      let response;

      try {
        response = JSON.parse(text);
      } catch (e) {
        console.error(`   JSON parse failed. Raw: ${text.slice(0, 200)}`);
        throw new Error('Model did not return valid JSON');
      }

      const validation = validateEnrichmentResponse(response);
      if (!validation.valid) {
        console.error(`   Validation failed:`, validation.errors);
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      // Track opening text for anti-repetition
      this.recentOpeningTexts.push(response.summary_spicy.slice(0, 50));
      if (this.recentOpeningTexts.length > 5) this.recentOpeningTexts.shift();

      // 5. Update pardon with optimistic concurrency check
      // Only update if enriched_at is still null (prevents double-enrichment race)
      // Note: enrichment_prompt_version column requires migration 060
      const { data: updateData, error: updateError } = await this.supabase
        .from('pardons')
        .update({
          summary_spicy: response.summary_spicy,
          why_it_matters: response.why_it_matters,
          pattern_analysis: response.pattern_analysis,
          enriched_at: new Date().toISOString(),
          // enrichment_prompt_version: PROMPT_VERSION, // Requires migration 060
          is_public: true // Make visible after enrichment
        })
        .eq('id', id)
        .is('enriched_at', null) // Optimistic concurrency: only update if not already enriched
        .select('id');

      if (updateError) {
        throw new Error(`Update failed: ${updateError.message}`);
      }

      // Check if row was actually updated (concurrency check)
      if (!updateData || updateData.length === 0) {
        console.log(`   Skipped (already enriched by another worker)`);
        this.stats.skipped++;
        return { success: true, skipped: true };
      }

      // 6. Track cost
      const usage = completion.usage || { prompt_tokens: 0, completion_tokens: 0 };
      const cost = this.calculateCost(usage);

      await this.trackCost(id, usage, cost);

      // 7. Update daily budget
      await updateDailyBudget(this.supabase, cost);

      console.log(`   Enriched (${usage.prompt_tokens}+${usage.completion_tokens} tokens, $${cost.toFixed(4)})`);

      return {
        success: true,
        cost,
        tokens: usage,
        summary_spicy: response.summary_spicy.slice(0, 100) + '...'
      };

    } catch (error) {
      console.error(`   Error: ${error.message}`);
      this.stats.errors++;
      return { success: false, error: error.message };
    }
  }

  /**
   * Calculate cost from token usage
   */
  calculateCost(usage) {
    const inputCost = (usage.prompt_tokens / 1000) * INPUT_COST_PER_1K;
    const outputCost = (usage.completion_tokens / 1000) * OUTPUT_COST_PER_1K;
    return inputCost + outputCost;
  }

  /**
   * Track cost in pardon_enrichment_costs table
   * Note: Requires migration 060. Falls back to console logging if table doesn't exist.
   */
  async trackCost(pardonId, usage, cost) {
    const { error } = await this.supabase
      .from('pardon_enrichment_costs')
      .insert({
        pardon_id: pardonId,
        input_tokens: usage.prompt_tokens,
        output_tokens: usage.completion_tokens,
        usd_estimate: cost,
        model: MODEL,
        prompt_version: PROMPT_VERSION,
        run_id: this.runId
      });

    if (error) {
      // If table doesn't exist (migration not applied), just log it
      if (error.message.includes('schema cache') || error.code === '42P01') {
        console.warn(`   Cost: $${cost.toFixed(6)} (table not yet created, requires migration 060)`);
      } else {
        console.error(`   COST TRACKING FAILED: ${error.message}`);
        console.error(`   Untracked cost: ${cost.toFixed(6)} for pardon ${pardonId}`);
        this.stats.costTrackingFailures++;
        this.stats.untrackedCost += cost;
      }
    }
  }

  /**
   * Main run loop
   */
  async run(limit = BATCH_SIZE, specificId = null) {
    console.log('\n========================================');
    console.log('Pardon GPT Enrichment');
    console.log('========================================');
    console.log(`Mode: ${this.dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log(`Force: ${this.force}`);
    console.log(`Limit: ${limit}`);
    console.log(`Prompt version: ${PROMPT_VERSION}`);
    console.log(`Run ID: ${this.runId || 'local'}`);

    // Budget check
    if (!this.dryRun) {
      const budget = await checkDailyBudget(this.supabase);
      console.log(`\nBudget: $${budget.spent.toFixed(2)} spent, $${budget.remaining.toFixed(2)} remaining`);

      if (!budget.ok) {
        console.error('\nDaily budget exceeded. Halting.');
        return this.stats;
      }
    }

    // Get pending pardons
    const pardons = await this.getPendingPardons(limit, specificId);
    console.log(`\nFound ${pardons.length} pardon(s) to enrich`);

    if (pardons.length === 0) {
      console.log('Nothing to do.');
      return this.stats;
    }

    // Process each pardon
    for (const pardon of pardons) {
      this.stats.processed++;

      // Budget re-check between pardons
      if (!this.dryRun && this.stats.processed > 1) {
        const budget = await checkDailyBudget(this.supabase);
        if (!budget.ok) {
          console.log('\n Budget limit reached mid-batch. Stopping.');
          break;
        }
      }

      const result = await this.enrichPardon(pardon);

      if (result.success) {
        if (result.dryRun) {
          this.stats.skipped++;
        } else {
          this.stats.enriched++;
          this.stats.totalCost += result.cost || 0;
        }
      }

      // Rate limiting delay
      if (this.stats.processed < pardons.length) {
        await new Promise(r => setTimeout(r, DELAY_BETWEEN_MS));
      }
    }

    // Summary
    console.log('\n========================================');
    console.log('Summary');
    console.log('========================================');
    console.log(`Processed: ${this.stats.processed}`);
    console.log(`Enriched:  ${this.stats.enriched}`);
    console.log(`Skipped:   ${this.stats.skipped}`);
    console.log(`Errors:    ${this.stats.errors}`);
    console.log(`Total cost: $${this.stats.totalCost.toFixed(4)}`);

    if (this.stats.costTrackingFailures > 0) {
      console.warn(`\n Cost tracking failures: ${this.stats.costTrackingFailures}`);
      console.warn(`   Untracked cost: $${this.stats.untrackedCost.toFixed(6)}`);
    }

    return this.stats;
  }
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : BATCH_SIZE;

  const idArg = args.find(a => a.startsWith('--id='));
  const specificId = idArg ? parseInt(idArg.split('=')[1], 10) : null;

  const runId = process.env.RUN_ID || null;

  try {
    const supabase = createSupabaseClient();
    const openai = createOpenAIClient();

    const worker = new PardonEnrichmentWorker({
      supabase,
      openai,
      dryRun,
      force,
      runId
    });

    const stats = await worker.run(limit, specificId);

    // Exit code based on errors
    if (stats.errors > 0 && stats.enriched === 0) {
      process.exit(1); // All failed
    }

    process.exit(0);

  } catch (error) {
    console.error('\n FATAL:', error.message);
    process.exit(1);
  }
}

main();
