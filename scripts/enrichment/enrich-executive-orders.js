/**
 * Executive Order Enrichment Worker (TTRC-218)
 *
 * Production-grade worker with:
 * - Idempotency (eo.id + prompt_version)
 * - Exponential backoff retries (3 attempts: 5s, 20s, 60s)
 * - Rate limiting (TokenBucket, 10 req/min)
 * - Daily cost cap ($5/day or 3× 7-day avg)
 * - Dead-letter queue (eo_enrichment_errors)
 * - Cost tracking (eo_enrichment_costs)
 * - Validation (word counts, tier rules, JSON schema)
 *
 * Usage:
 *   node scripts/enrichment/enrich-executive-orders.js [batchSize]
 *
 * Examples:
 *   node scripts/enrichment/enrich-executive-orders.js      # Enrich 5 EOs
 *   node scripts/enrichment/enrich-executive-orders.js 20   # Enrich 20 EOs
 *   node scripts/enrichment/enrich-executive-orders.js 190  # Full backfill
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { EO_ENRICHMENT_PROMPT, buildEOPayload } from './prompts.js';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const PROMPT_VERSION = 'v1';
const DAILY_CAP_USD = 5.00;
const MAX_RETRIES = 3;
const BACKOFF_MS = [5000, 20000, 60000]; // 5s, 20s, 60s
const REQUEST_TIMEOUT_MS = 60000; // 60 seconds

// OpenAI pricing (gpt-4o-mini as of 2025-01-01)
const INPUT_COST_PER_1K = 0.00015;
const OUTPUT_COST_PER_1K = 0.0006;

// ============================================================================
// CLIENTS
// ============================================================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ============================================================================
// TOKEN BUCKET RATE LIMITER
// ============================================================================

/**
 * Token bucket rate limiter for smooth traffic control
 * Prevents rate limit errors with OpenAI API
 */
class TokenBucket {
  constructor(capacity = 10, refillRate = 10) {
    this.capacity = capacity;       // Max tokens in bucket
    this.tokens = capacity;          // Current tokens
    this.refillRate = refillRate;    // Tokens per minute
    this.lastRefill = Date.now();
  }

  /**
   * Consume one token, wait if necessary
   */
  async consume() {
    this.refill();

    if (this.tokens < 1) {
      const waitMs = Math.ceil(60000 / this.refillRate);
      console.log(`   Rate limit: waiting ${waitMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
      this.refill();
    }

    this.tokens -= 1;
  }

  /**
   * Refill tokens based on elapsed time
   */
  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 60000; // Minutes elapsed
    const tokensToAdd = elapsed * this.refillRate;
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

// ============================================================================
// EO ENRICHMENT WORKER
// ============================================================================

class EOEnrichmentWorker {
  constructor() {
    this.rateLimiter = new TokenBucket(10, 10); // 10 req/min
    this.successCount = 0;
    this.failCount = 0;
  }

  /**
   * Main entry point: Enrich a batch of executive orders
   * @param {number} limit - Max number of EOs to process
   */
  async enrichBatch(limit = 5) {
    console.log(`\n🔍 Executive Order Enrichment Worker`);
    console.log(`=====================================`);
    console.log(`Batch size: ${limit}`);
    console.log(`Prompt version: ${PROMPT_VERSION}\n`);

    // 1. Check daily cap
    try {
      await this.checkDailyCap();
    } catch (error) {
      console.error(`\n❌ Daily cap exceeded: ${error.message}\n`);
      process.exit(1);
    }

    // 2. Get unenriched EOs
    const { data: eos, error } = await supabase
      .from('executive_orders')
      .select('*')
      .or(`enriched_at.is.null,prompt_version.neq.${PROMPT_VERSION}`)
      .order('date', { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`\n❌ Database error: ${error.message}\n`);
      process.exit(1);
    }

    if (!eos || eos.length === 0) {
      console.log('✅ No unenriched EOs found (all up-to-date)\n');
      return;
    }

    console.log(`📋 Found ${eos.length} EOs to enrich\n`);

    // 3. Process each with rate limiting
    for (const eo of eos) {
      await this.rateLimiter.consume();
      await this.enrichWithRetry(eo);
    }

    // 4. Summary
    await this.printSummary();
  }

  /**
   * Enrich single EO with retry logic
   * @param {Object} eo - Executive order database record
   * @param {number} attempt - Current attempt number (0-indexed)
   * @param {boolean} skipIdempotencyCheck - Skip already-enriched check (used when called from export function)
   */
  async enrichWithRetry(eo, attempt = 0, skipIdempotencyCheck = false) {
    // Skip if already enriched at this version (idempotency)
    if (!skipIdempotencyCheck && eo.enriched_at && eo.prompt_version === PROMPT_VERSION) {
      console.log(`✓ Skip EO ${eo.order_number} - already enriched at ${PROMPT_VERSION}`);
      return;
    }

    try {
      console.log(`🤖 Enriching EO ${eo.order_number}: ${eo.title.substring(0, 50)}...`);

      // Call OpenAI with timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const completion = await openai.chat.completions.create(
        {
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: EO_ENRICHMENT_PROMPT },
            { role: 'user', content: buildEOPayload(eo) }
          ],
          response_format: { type: 'json_object' },
          max_tokens: 4000,
          temperature: 0.7,
        },
        { signal: controller.signal }
      );

      clearTimeout(timeout);

      // Parse and validate response
      const enrichment = JSON.parse(completion.choices[0].message.content);
      this.validateEnrichment(enrichment);

      // Update database
      const { error: updateError } = await supabase
      .from('executive_orders')
      .update({
      section_what_they_say: enrichment.section_what_they_say,
      section_what_it_means: enrichment.section_what_it_means,
      section_reality_check: enrichment.section_reality_check,
      section_why_it_matters: enrichment.section_why_it_matters,
      category: enrichment.category,
      regions: enrichment.regions || [],
      policy_areas: enrichment.policy_areas || [],
      affected_agencies: enrichment.affected_agencies || [],
      action_tier: enrichment.action_tier,
      action_confidence: enrichment.action_confidence,
      action_reasoning: enrichment.action_reasoning || '',
      action_section: enrichment.action_section || null,
      enriched_at: new Date().toISOString(),
      prompt_version: PROMPT_VERSION,
      })
      .eq('id', eo.id);

      if (updateError) throw updateError;

      // Track cost
      await this.trackCost(eo.id, completion.usage);

      const cost = this.calculateCost(completion.usage);
      console.log(`✅ Enriched EO ${eo.order_number} (${completion.usage.total_tokens} tokens, $${cost.toFixed(4)})\n`);
      this.successCount++;

    } catch (error) {
      // Retry logic
      if (attempt < MAX_RETRIES - 1) {
        const backoff = BACKOFF_MS[attempt];
        console.log(`⚠️  Retry ${attempt + 1}/${MAX_RETRIES} after ${backoff}ms: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        return this.enrichWithRetry(eo, attempt + 1);
      } else {
        // Dead letter after final failure
        await this.logError(eo.id, error, attempt + 1);
        console.error(`❌ Failed EO ${eo.order_number} after ${MAX_RETRIES} attempts: ${error.message}\n`);
        this.failCount++;
      }
    }
  }

  /**
   * Validate enrichment data structure and content
   * @param {Object} data - Parsed JSON from OpenAI
   * @throws {Error} if validation fails
   */
  validateEnrichment(data) {
    // Required fields
    const required = [
      'section_what_they_say',
      'section_what_it_means',
      'section_reality_check',
      'section_why_it_matters',
      'category',
      'action_tier',
      'action_confidence',
    ];

    for (const field of required) {
      if (data[field] === undefined || data[field] === null) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Word count validation (100-160 words per section)
    const sections = [
      'section_what_they_say',
      'section_what_it_means',
      'section_reality_check',
      'section_why_it_matters',
    ];

    for (const section of sections) {
      const text = data[section].trim();
      const words = text.split(/\s+/).filter(w => w.length > 0).length;

      if (words < 100 || words > 160) {
        throw new Error(`${section} must be 100-160 words (got ${words})`);
      }
    }

    // Category validation
    const validCategories = [
      'immigration_border',
      'environment_energy',
      'health_care',
      'education',
      'justice_civil_rights_voting',
      'natsec_foreign',
      'economy_jobs_taxes',
      'technology_data_privacy',
      'infra_housing_transport',
      'gov_ops_workforce',
    ];

    if (!validCategories.includes(data.category)) {
      throw new Error(`Invalid category: ${data.category}`);
    }

    // Severity validation (SKIPPED - only FE labels matter)
    // Backend severity can be remapped later if needed
    // const validSeverities = ['critical', 'severe', 'moderate', 'minor'];
    // if (!validSeverities.includes(data.severity)) {
    //   throw new Error(`Invalid severity: ${data.severity}`);
    // }

    // Action tier validation
    const validTiers = ['direct', 'systemic', 'tracking'];
    if (!validTiers.includes(data.action_tier)) {
      throw new Error(`Invalid action_tier: ${data.action_tier}`);
    }

    // Tier 1 validation (requires ≥2 actions with URL/phone)
    if (data.action_tier === 'direct') {
      const actions = data.action_section?.actions || [];

      if (actions.length < 2) {
        throw new Error('Tier 1 (direct) requires ≥2 actions');
      }

      const hasValidContact = actions.some(
        a => a.url || /\d{3}[-\s]?\d{3}[-\s]?\d{4}/.test(a.description)
      );

      if (!hasValidContact) {
        throw new Error('Tier 1 (direct) requires ≥1 URL or phone number');
      }
    }

    // Tier 3 validation (no actions)
    if (data.action_tier === 'tracking') {
      if (data.action_section && data.action_section.actions?.length > 0) {
        throw new Error('Tier 3 (tracking) cannot have actions');
      }
    }

    // Action confidence validation
    if (data.action_confidence < 0 || data.action_confidence > 10) {
      throw new Error(`action_confidence must be 0-10 (got ${data.action_confidence})`);
    }
  }

  /**
   * Check if daily cost cap has been exceeded
   * Uses dynamic cap: min($5, 3× trailing 7-day average)
   * @throws {Error} if cap exceeded
   */
  async checkDailyCap() {
    const today = new Date().toISOString().slice(0, 10);

    // Get today's spending
    const { data: todayData } = await supabase
      .from('eo_enrichment_costs')
      .select('usd_estimate')
      .gte('created_at', `${today}T00:00:00Z`);

    const todayTotal = todayData?.reduce((sum, r) => sum + parseFloat(r.usd_estimate || 0), 0) || 0;

    // Get trailing 7-day average
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: weekData } = await supabase
      .from('eo_enrichment_costs')
      .select('usd_estimate')
      .gte('created_at', sevenDaysAgo);

    const weekTotal = weekData?.reduce((sum, r) => sum + parseFloat(r.usd_estimate || 0), 0) || 0;
    const weekAvg = weekTotal / 7;

    // Dynamic cap: min($5, 3× 7-day avg)
    const dynamicCap = Math.min(DAILY_CAP_USD, Math.max(weekAvg * 3, 0.50)); // Min $0.50 cap

    if (todayTotal >= dynamicCap) {
      throw new Error(
        `Daily cap exceeded: $${todayTotal.toFixed(4)} >= $${dynamicCap.toFixed(4)} ` +
        `(static: $${DAILY_CAP_USD}, dynamic: 3× $${weekAvg.toFixed(4)} avg)`
      );
    }

    console.log(`💰 Cost check:`);
    console.log(`   Today: $${todayTotal.toFixed(4)}`);
    console.log(`   Dynamic cap: $${dynamicCap.toFixed(4)}`);
    console.log(`   Remaining: $${(dynamicCap - todayTotal).toFixed(4)}\n`);
  }

  /**
   * Calculate cost from OpenAI usage
   * @param {Object} usage - OpenAI usage object
   * @returns {number} Cost in USD
   */
  calculateCost(usage) {
    const inputCost = (usage.prompt_tokens / 1000) * INPUT_COST_PER_1K;
    const outputCost = (usage.completion_tokens / 1000) * OUTPUT_COST_PER_1K;
    return inputCost + outputCost;
  }

  /**
   * Track enrichment cost in database
   * @param {string} eo_id - EO ID
   * @param {Object} usage - OpenAI usage object
   */
  async trackCost(eo_id, usage) {
    const cost = this.calculateCost(usage);

    const { error } = await supabase.from('eo_enrichment_costs').insert({
      eo_id,
      input_tokens: usage.prompt_tokens,
      output_tokens: usage.completion_tokens,
      usd_estimate: cost,
      model: 'gpt-4o-mini',
      prompt_version: PROMPT_VERSION,
    });

    if (error) {
      console.error(`⚠️  Failed to track cost: ${error.message}`);
    }
  }

  /**
   * Log error to dead-letter queue
   * @param {string} eo_id - EO ID
   * @param {Error} error - Error object
   * @param {number} attempts - Number of attempts made
   */
  async logError(eo_id, error, attempts) {
    const { error: insertError } = await supabase.from('eo_enrichment_errors').insert({
      eo_id,
      error_code: error.code || error.name || 'UNKNOWN',
      message: error.message,
      attempt_count: attempts,
    });

    if (insertError) {
      console.error(`⚠️  Failed to log error: ${insertError.message}`);
    }
  }

  /**
   * Print summary statistics
   */
  async printSummary() {
    console.log(`\n📊 Enrichment Summary:`);
    console.log(`   Successful: ${this.successCount}`);
    console.log(`   Failed: ${this.failCount}`);

    // 24-hour cost
    const { data: costs } = await supabase
      .from('eo_enrichment_costs')
      .select('usd_estimate')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const total24h = costs?.reduce((sum, r) => sum + parseFloat(r.usd_estimate || 0), 0) || 0;

    console.log(`\n💰 Cost (24 hours):`);
    console.log(`   Total: $${total24h.toFixed(4)}`);
    console.log(`   Daily cap: $${DAILY_CAP_USD.toFixed(2)}`);
    console.log(`   Remaining: $${(DAILY_CAP_USD - total24h).toFixed(4)}\n`);

    // Dead letters
    if (this.failCount > 0) {
      console.log(`\n⚠️  Check dead-letter queue:`);
      console.log(`   SELECT * FROM eo_enrichment_errors ORDER BY created_at DESC LIMIT 10;\n`);
    }
  }
}

// ============================================================================
// EXPORTED FUNCTIONS (for integration with collection script)
// ============================================================================

/**
 * Enrich a single executive order
 * Used by collection script to auto-enrich new EOs
 * @param {Object} eo - Executive order object (must have id, order_number, title)
 * @param {boolean} skipIdempotencyCheck - Skip the already-enriched check (for new EOs from collection)
 * @returns {Promise<{success: boolean, enriched?: boolean, skipped?: boolean, error?: string}>}
 */
export async function enrichExecutiveOrder(eo, skipIdempotencyCheck = false) {
  const worker = new EOEnrichmentWorker();

  try {
    // Check daily cap before enriching
    await worker.checkDailyCap();

    // Skip if already enriched at this version (unless caller says skip this check)
    if (!skipIdempotencyCheck && eo.enriched_at && eo.prompt_version === PROMPT_VERSION) {
      return { success: true, skipped: true, reason: 'already_enriched' };
    }

    // Rate limit
    await worker.rateLimiter.consume();

    // Enrich with retry (skip idempotency check since we just did it)
    const initialSuccessCount = worker.successCount;
    await worker.enrichWithRetry(eo, 0, true);

    // Check if enrichment actually succeeded
    if (worker.successCount > initialSuccessCount) {
      return { success: true, enriched: true };
    } else {
      // enrichWithRetry logged to dead-letter queue
      return { success: false, error: 'Enrichment failed after retries' };
    }
  } catch (error) {
    // Cap exceeded or other fatal error
    return { success: false, error: error.message };
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  // Validate environment variables
  if (!process.env.SUPABASE_URL) {
    console.error('❌ Missing SUPABASE_URL environment variable\n');
    process.exit(1);
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable\n');
    process.exit(1);
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Missing OPENAI_API_KEY environment variable\n');
    process.exit(1);
  }

  // Get batch size from args or default to 5
  const batchSize = parseInt(process.argv[2], 10) || 5;

  if (isNaN(batchSize) || batchSize < 1) {
    console.error('❌ Invalid batch size. Usage: node enrich-executive-orders.js [batchSize]\n');
    process.exit(1);
  }

  // Create worker and run
  const worker = new EOEnrichmentWorker();
  await worker.enrichBatch(batchSize);
}

// Only run main if executed directly (not imported)
// Check if this file is being run directly vs imported
const isMainModule = process.argv[1] && (
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')) ||
  process.argv[1].includes('enrich-executive-orders.js')
);

if (isMainModule) {
  main().catch(err => {
    console.error('\n❌ Fatal error:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}
