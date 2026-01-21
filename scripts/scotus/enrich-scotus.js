/**
 * SCOTUS Case Enrichment Script (ADO-85)
 *
 * Enriches SCOTUS cases with GPT-4o-mini editorial analysis.
 * Uses existing prompt infrastructure from scotus-gpt-prompt.js.
 *
 * Usage:
 *   node scripts/scotus/enrich-scotus.js              # Enrich up to 10 cases (TEST only)
 *   node scripts/scotus/enrich-scotus.js --limit=5    # Enrich 5 cases
 *   node scripts/scotus/enrich-scotus.js --dry-run    # Preview without DB writes
 *   node scripts/scotus/enrich-scotus.js --prod       # Write to PROD (requires explicit flag)
 *
 * Requirements:
 *   - SUPABASE_TEST_URL or SUPABASE_URL
 *   - SUPABASE_TEST_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY
 *   - OPENAI_API_KEY
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Import SCOTUS prompt infrastructure
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  validateEnrichmentResponse,
  profanityAllowed
} from '../enrichment/scotus-gpt-prompt.js';

import {
  getPoolType,
  selectVariation,
  buildVariationInjection
} from '../enrichment/scotus-variation-pools.js';

dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const PROMPT_VERSION = 'v1-ado85';
const DEFAULT_BATCH_SIZE = 10;
const MAX_SAFE_LIMIT = 100;  // Warn if user requests more than this
const DEFAULT_DAILY_CAP_USD = 5.00;
const MAX_RETRIES = 2;
const BACKOFF_MS = [3000, 10000]; // 3s, 10s
const MAX_SYLLABUS_CHARS = 12000; // Truncate syllabus beyond this

// OpenAI pricing (gpt-4o-mini as of 2025-01-01)
const INPUT_COST_PER_1K = 0.00015;
const OUTPUT_COST_PER_1K = 0.0006;

// ============================================================================
// PARSE CLI ARGUMENTS
// ============================================================================

function parseArgs() {
  const args = {
    limit: DEFAULT_BATCH_SIZE,
    dryRun: false,
    allowProd: false
  };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--limit=')) {
      args.limit = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--prod') {
      args.allowProd = true;
    } else if (!isNaN(parseInt(arg, 10))) {
      // Support positional argument for limit
      args.limit = parseInt(arg, 10);
    }
  }

  return args;
}

// ============================================================================
// ENVIRONMENT HELPERS
// ============================================================================

/**
 * Check if a URL is the PROD database
 * Uses exact URL match when possible, falls back to project ref substring
 */
function detectIsProd(url) {
  if (!url) return false;

  // Primary: exact URL match against known PROD env var
  if (process.env.SUPABASE_URL && url === process.env.SUPABASE_URL) {
    return true;
  }

  // Fallback: project ref substring (only if SUPABASE_URL not set)
  // PROD project ref: osjbulmltfpcoldydexg
  if (!process.env.SUPABASE_URL && url.includes('osjbulmltfpcoldydexg')) {
    return true;
  }

  return false;
}

/**
 * Determine which Supabase URL to use
 * Prefers TEST, only returns PROD if explicitly allowed via allowProd
 */
function getSupabaseConfig(allowProd) {
  const testUrl = process.env.SUPABASE_TEST_URL;
  const testKey = process.env.SUPABASE_TEST_SERVICE_KEY;
  const prodUrl = process.env.SUPABASE_URL;
  const prodKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Prefer TEST environment
  if (testUrl && testKey) {
    return { url: testUrl, key: testKey, isProd: detectIsProd(testUrl) };
  }

  // PROD only if explicitly allowed
  if (allowProd && prodUrl && prodKey) {
    return { url: prodUrl, key: prodKey, isProd: detectIsProd(prodUrl) };
  }

  // If PROD vars exist but not allowed, return null (force explicit --prod)
  if (prodUrl && prodKey && !allowProd) {
    return null; // Will trigger helpful error message
  }

  return null;
}

// ============================================================================
// SAFETY HELPERS
// ============================================================================

/**
 * Safe case name for display (handles null/empty)
 */
function safeCaseName(scotusCase) {
  const raw = (scotusCase?.case_name || '').trim();
  return raw.length > 0 ? raw : `[Unnamed case ID=${scotusCase?.id || 'unknown'}]`;
}

/**
 * Truncate text to max chars, appending notice if truncated
 */
function truncate(text, maxChars) {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[TRUNCATED - original was ${text.length} chars]`;
}

/**
 * Safely extract JSON from OpenAI completion
 */
function getCompletionJson(completion) {
  const content = completion?.choices?.[0]?.message?.content;

  if (!content || typeof content !== 'string') {
    throw new Error('GPT returned empty or non-string content');
  }

  try {
    return JSON.parse(content);
  } catch (e) {
    const preview = content.slice(0, 500);
    throw new Error(`Failed to parse GPT response as JSON. Preview: ${preview}`);
  }
}

// ============================================================================
// COST TRACKING
// ============================================================================

/**
 * Calculate cost from OpenAI usage (handles missing/partial usage data)
 */
function calculateCost(usage) {
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const inputCost = (promptTokens / 1000) * INPUT_COST_PER_1K;
  const outputCost = (completionTokens / 1000) * OUTPUT_COST_PER_1K;
  return inputCost + outputCost;
}

/**
 * Atomic budget increment using RPC (preferred) with fallback
 */
async function incrementBudgetAtomic(supabase, costUsd) {
  const today = new Date().toISOString().slice(0, 10);

  // Preferred: Use atomic RPC function
  const { error: rpcError } = await supabase.rpc('increment_budget', {
    p_day: today,
    p_cost: costUsd,
    p_calls: 1
  });

  if (!rpcError) {
    return; // Success
  }

  // Fallback: Non-atomic upsert (only if RPC fails)
  console.warn(`   ⚠️ increment_budget RPC failed, using fallback: ${rpcError.message}`);

  const { data: existing } = await supabase
    .from('budgets')
    .select('spent_usd, openai_calls')
    .eq('day', today)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('budgets')
      .update({
        spent_usd: (parseFloat(existing.spent_usd) || 0) + costUsd,
        openai_calls: (existing.openai_calls || 0) + 1
      })
      .eq('day', today);
  } else {
    await supabase
      .from('budgets')
      .insert({
        day: today,
        spent_usd: costUsd,
        openai_calls: 1,
        cap_usd: DEFAULT_DAILY_CAP_USD
      });
  }
}

/**
 * Check if daily cap exceeded
 * Returns { todaySpent, cap } or throws if exceeded
 */
async function checkDailyCap(supabase) {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('budgets')
    .select('spent_usd, cap_usd')
    .eq('day', today)
    .maybeSingle();

  if (error) {
    console.warn(`   ⚠️ Could not check budget: ${error.message}`);
    // Continue with default cap
  }

  const todaySpent = parseFloat(data?.spent_usd) || 0;
  const cap = parseFloat(data?.cap_usd) || DEFAULT_DAILY_CAP_USD;

  if (todaySpent >= cap) {
    throw new Error(`Daily cap exceeded: $${todaySpent.toFixed(4)} >= $${cap.toFixed(2)}`);
  }

  return { todaySpent, cap };
}

// ============================================================================
// ENRICHMENT LOGIC
// ============================================================================

/**
 * Enrich a single SCOTUS case
 */
async function enrichCase(supabase, openai, scotusCase, recentPatternIds, dryRun) {
  const displayName = safeCaseName(scotusCase);
  console.log(`\n🤖 Enriching: ${displayName.substring(0, 60)}...`);
  console.log(`   ID: ${scotusCase.id} | Term: ${scotusCase.term || 'N/A'} | Decided: ${scotusCase.decided_at?.slice(0, 10) || 'N/A'}`);

  // 1. Estimate ruling impact level from metadata (rough guess for variation selection)
  const estimatedLevel = estimateImpactLevel(scotusCase);
  console.log(`   Estimated impact level: ${estimatedLevel} (for variation selection)`);

  // 2. Select variation pool and pattern
  const poolType = getPoolType(estimatedLevel, scotusCase.issue_area);
  const variation = selectVariation(poolType, recentPatternIds);
  const patternId = variation.opening?.id || 'unknown';
  console.log(`   Pool: ${poolType} | Pattern: ${patternId}`);

  // 3. Build variation injection
  const variationInjection = buildVariationInjection(variation, []);

  // 4. Prepare case data with truncated text fields
  const syllabusTruncated = truncate(scotusCase.syllabus, MAX_SYLLABUS_CHARS);
  const excerptTruncated = truncate(scotusCase.opinion_excerpt, MAX_SYLLABUS_CHARS);
  const caseForPrompt = {
    ...scotusCase,
    syllabus: syllabusTruncated,
    opinion_excerpt: excerptTruncated
  };

  // 5. Build user prompt
  const userPrompt = buildUserPrompt(caseForPrompt, variationInjection);

  if (dryRun) {
    const syllabusLen = scotusCase.syllabus?.length || 0;
    const excerptLen = scotusCase.opinion_excerpt?.length || 0;
    console.log(`\n   [DRY RUN] Would send to GPT:`);
    console.log(`   System prompt length: ${SYSTEM_PROMPT.length} chars`);
    console.log(`   User prompt length: ${userPrompt.length} chars`);
    console.log(`   Syllabus: ${syllabusLen} chars${syllabusLen > MAX_SYLLABUS_CHARS ? ` (truncated to ${syllabusTruncated.length})` : ''}`);
    console.log(`   Excerpt: ${excerptLen} chars${excerptLen > MAX_SYLLABUS_CHARS ? ` (truncated to ${excerptTruncated.length})` : ''}`);
    return { success: true, dryRun: true, patternId };
  }

  // 6. Call GPT-4o-mini with retries
  let completion;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const backoff = BACKOFF_MS[attempt - 1];
        console.log(`   Retry ${attempt}/${MAX_RETRIES} after ${backoff}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
      }

      completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1500,
        temperature: 0.7,
      });

      break; // Success, exit retry loop
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw new Error(`GPT call failed after ${MAX_RETRIES + 1} attempts: ${error.message}`);
      }
    }
  }

  // 7. Parse and validate response (with safety checks)
  const enrichment = getCompletionJson(completion);

  const { valid, errors } = validateEnrichmentResponse(enrichment);
  if (!valid) {
    throw new Error(`Validation failed: ${errors.join(', ')}`);
  }

  // 8. Write to database
  const { error: updateError } = await supabase
    .from('scotus_cases')
    .update({
      ruling_impact_level: enrichment.ruling_impact_level,
      ruling_label: enrichment.ruling_label,
      who_wins: enrichment.who_wins,
      who_loses: enrichment.who_loses,
      summary_spicy: enrichment.summary_spicy,
      why_it_matters: enrichment.why_it_matters,
      dissent_highlights: enrichment.dissent_highlights,
      evidence_anchors: enrichment.evidence_anchors,
      enriched_at: new Date().toISOString(),
      prompt_version: PROMPT_VERSION,
      is_public: true  // Make visible after enrichment
    })
    .eq('id', scotusCase.id);

  if (updateError) {
    throw new Error(`Database update failed: ${updateError.message}`);
  }

  // 9. Track cost atomically
  const cost = calculateCost(completion.usage);
  await incrementBudgetAtomic(supabase, cost);

  console.log(`   ✅ Enriched (${completion.usage.total_tokens} tokens, $${cost.toFixed(4)})`);
  console.log(`   Level: ${enrichment.ruling_impact_level} (${enrichment.ruling_label})`);
  console.log(`   Who wins: ${(enrichment.who_wins || '').substring(0, 50)}...`);

  return {
    success: true,
    patternId,
    poolType,
    level: enrichment.ruling_impact_level,
    tokens: completion.usage.total_tokens,
    cost
  };
}

/**
 * Estimate impact level from case metadata (heuristic for variation selection)
 * GPT will determine the actual level during enrichment
 */
function estimateImpactLevel(scotusCase) {
  const name = (scotusCase.case_name || '').toLowerCase();
  const syllabusOrExcerpt = (scotusCase.syllabus || scotusCase.opinion_excerpt || '').toLowerCase();
  const combined = `${name} ${syllabusOrExcerpt}`;

  // Look for strong signals
  const crisisSignals = ['overturn', 'overrule', 'precedent', 'unconstitutional'];
  const tyrannySignals = ['immunity', 'qualified immunity', 'police', 'enforcement', 'executive power'];
  const sabotageSignals = ['standing', 'moot', 'procedural', 'jurisdiction'];
  const winSignals = ['affirm', 'plaintiff', 'worker', 'employee', 'union', 'rights'];

  for (const signal of crisisSignals) {
    if (combined.includes(signal)) return 5;
  }

  for (const signal of tyrannySignals) {
    if (combined.includes(signal)) return 4;
  }

  for (const signal of winSignals) {
    if (combined.includes(signal)) return 1;
  }

  for (const signal of sabotageSignals) {
    if (combined.includes(signal)) return 3;
  }

  // Default to middle-ground (institutional sabotage)
  return 3;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = parseArgs();

  console.log(`\n🔍 SCOTUS Enrichment Script (ADO-85)`);
  console.log(`=====================================`);
  console.log(`Batch size: ${args.limit}`);
  console.log(`Dry run: ${args.dryRun}`);
  console.log(`Allow PROD: ${args.allowProd}`);
  console.log(`Prompt version: ${PROMPT_VERSION}\n`);

  // Validate OpenAI key
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Missing OPENAI_API_KEY environment variable');
    process.exit(1);
  }

  // Get Supabase config with safety checks
  const dbConfig = getSupabaseConfig(args.allowProd);
  if (!dbConfig) {
    console.error('❌ Missing Supabase environment variables');
    console.error('   Need: SUPABASE_TEST_URL + SUPABASE_TEST_SERVICE_KEY');
    console.error('   Or:   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (with --prod flag)');
    process.exit(1);
  }

  // Safety gate: refuse PROD writes without explicit --prod flag
  if (dbConfig.isProd && !args.dryRun && !args.allowProd) {
    console.error('❌ Refusing to write to PROD without --prod flag');
    console.error('   Use --prod to explicitly allow PROD writes');
    console.error('   Or set SUPABASE_TEST_URL for TEST environment');
    process.exit(1);
  }

  const envLabel = dbConfig.isProd ? '⚠️  PROD' : 'TEST';
  console.log(`Database: ${envLabel}`);

  if (dbConfig.isProd && !args.dryRun) {
    console.log(`\n⚠️  WARNING: Writing to PRODUCTION database!`);
    console.log(`   Press Ctrl+C within 3 seconds to abort...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // Create clients
  const supabase = createClient(dbConfig.url, dbConfig.key);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Check daily cap
  if (!args.dryRun) {
    try {
      const { todaySpent, cap } = await checkDailyCap(supabase);
      console.log(`\n💰 Budget: $${todaySpent.toFixed(4)} spent today (cap: $${cap.toFixed(2)})`);
    } catch (error) {
      console.error(`\n❌ ${error.message}`);
      process.exit(1);
    }
  }

  // Warn if batch size exceeds safe limit (egress/cost protection)
  if (args.limit > MAX_SAFE_LIMIT && !args.dryRun) {
    const estimatedEgressMB = (args.limit * 2.5 / 1000).toFixed(1);
    console.warn(`\n⚠️  Warning: Batch size ${args.limit} exceeds recommended max (${MAX_SAFE_LIMIT})`);
    console.warn(`   Estimated DB egress: ~${estimatedEgressMB}MB`);
    console.warn(`   Press Ctrl+C within 5 seconds to abort...`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  // Query unenriched cases - only select fields needed for enrichment
  // (avoids fetching large unused fields, reduces DB egress)
  const { data: cases, error: queryError } = await supabase
    .from('scotus_cases')
    .select(`
      id,
      case_name,
      case_name_short,
      docket_number,
      term,
      decided_at,
      argued_at,
      vote_split,
      majority_author,
      dissent_authors,
      syllabus,
      opinion_excerpt,
      issue_area,
      petitioner_type,
      respondent_type
    `)
    .is('enriched_at', null)
    .or('syllabus.not.is.null,opinion_excerpt.not.is.null')  // Must have syllabus OR excerpt
    .order('decided_at', { ascending: false })
    .limit(args.limit);

  if (queryError) {
    console.error(`\n❌ Query failed: ${queryError.message}`);
    process.exit(1);
  }

  if (!cases || cases.length === 0) {
    console.log('\n✅ No unenriched cases found.');
    console.log('   (Cases need syllabus or opinion_excerpt to be enriched)\n');
    return;
  }

  console.log(`\n📋 Found ${cases.length} case(s) to enrich\n`);

  // Process cases
  const recentPatternIds = [];
  let successCount = 0;
  let failCount = 0;
  let totalCost = 0;

  for (const scotusCase of cases) {
    try {
      const result = await enrichCase(supabase, openai, scotusCase, recentPatternIds, args.dryRun);

      if (result.success) {
        successCount++;
        if (result.patternId) {
          recentPatternIds.push(result.patternId);
          if (recentPatternIds.length > 10) recentPatternIds.shift();
        }
        if (result.cost) totalCost += result.cost;
      }
    } catch (error) {
      console.error(`   ❌ Failed: ${error.message}`);
      failCount++;
    }

    // Small delay between cases to avoid rate limits
    if (!args.dryRun) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Summary
  console.log(`\n📊 Summary`);
  console.log(`   Successful: ${successCount}`);
  console.log(`   Failed: ${failCount}`);
  if (!args.dryRun && totalCost > 0) {
    console.log(`   Total cost: $${totalCost.toFixed(4)}`);
  }
  console.log('');
}

// Run if executed directly
main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
