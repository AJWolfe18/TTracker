/**
 * SCOTUS Case Enrichment Script (ADO-85 / ADO-280)
 *
 * Two-pass architecture for factual accuracy:
 *   Pass 0: Source quality gate (pre-GPT)
 *   Pass 1: Fact extraction (neutral, deterministic)
 *   Pass 2: Editorial framing (facts locked in)
 *
 * Usage:
 *   node scripts/scotus/enrich-scotus.js              # Enrich up to 10 cases (TEST only)
 *   node scripts/scotus/enrich-scotus.js --limit=5    # Enrich 5 cases
 *   node scripts/scotus/enrich-scotus.js --dry-run    # Preview without DB writes
 *   node scripts/scotus/enrich-scotus.js --prod       # Write to PROD (requires explicit flag)
 *   node scripts/scotus/enrich-scotus.js --skip-consensus  # Skip double Pass 1 (testing only)
 *
 * Requirements:
 *   - SUPABASE_TEST_URL or SUPABASE_URL
 *   - SUPABASE_TEST_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY
 *   - OPENAI_API_KEY
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Import two-pass infrastructure
import {
  checkSourceQuality,
  extractFactsWithConsensus,
  deriveCaseType,
  flagAndSkip,
  markFailed,
  writeEnrichment,
  getCasesToEnrich,
  callGPTWithRetry,
  sanitizeForDB
} from '../enrichment/scotus-fact-extraction.js';

import {
  validateNoDrift
} from '../enrichment/scotus-drift-validation.js';

import {
  validateEnrichmentResponse,
  buildPass2Messages
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

const PROMPT_VERSION = 'v2-ado280';
const DEFAULT_BATCH_SIZE = 10;
const MAX_SAFE_LIMIT = 100;
const DEFAULT_DAILY_CAP_USD = 5.00;

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
    allowProd: false,
    skipConsensus: false
  };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--limit=')) {
      args.limit = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--prod') {
      args.allowProd = true;
    } else if (arg === '--skip-consensus') {
      args.skipConsensus = true;
    } else if (!isNaN(parseInt(arg, 10))) {
      args.limit = parseInt(arg, 10);
    }
  }

  return args;
}

// ============================================================================
// ENVIRONMENT HELPERS
// ============================================================================

function detectIsProd(url) {
  if (!url) return false;
  if (process.env.SUPABASE_URL && url === process.env.SUPABASE_URL) {
    return true;
  }
  if (!process.env.SUPABASE_URL && url.includes('osjbulmltfpcoldydexg')) {
    return true;
  }
  return false;
}

function getSupabaseConfig(allowProd) {
  const testUrl = process.env.SUPABASE_TEST_URL;
  const testKey = process.env.SUPABASE_TEST_SERVICE_KEY;
  const prodUrl = process.env.SUPABASE_URL;
  const prodKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (testUrl && testKey) {
    return { url: testUrl, key: testKey, isProd: detectIsProd(testUrl) };
  }

  if (allowProd && prodUrl && prodKey) {
    return { url: prodUrl, key: prodKey, isProd: detectIsProd(prodUrl) };
  }

  if (prodUrl && prodKey && !allowProd) {
    return null;
  }

  return null;
}

// ============================================================================
// SAFETY HELPERS
// ============================================================================

function safeCaseName(scotusCase) {
  const raw = (scotusCase?.case_name || '').trim();
  return raw.length > 0 ? raw : `[Unnamed case ID=${scotusCase?.id || 'unknown'}]`;
}

function calculateCost(usage) {
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const inputCost = (promptTokens / 1000) * INPUT_COST_PER_1K;
  const outputCost = (completionTokens / 1000) * OUTPUT_COST_PER_1K;
  return inputCost + outputCost;
}

// ============================================================================
// COST TRACKING
// ============================================================================

async function incrementBudgetAtomic(supabase, costUsd) {
  const today = new Date().toISOString().slice(0, 10);

  const { error: rpcError } = await supabase.rpc('increment_budget', {
    p_day: today,
    p_cost: costUsd,
    p_calls: 1
  });

  if (!rpcError) return;

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

async function checkDailyCap(supabase) {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('budgets')
    .select('spent_usd, cap_usd')
    .eq('day', today)
    .maybeSingle();

  if (error) {
    console.warn(`   ⚠️ Could not check budget: ${error.message}`);
  }

  const todaySpent = parseFloat(data?.spent_usd) || 0;
  const cap = parseFloat(data?.cap_usd) || DEFAULT_DAILY_CAP_USD;

  if (todaySpent >= cap) {
    throw new Error(`Daily cap exceeded: $${todaySpent.toFixed(4)} >= $${cap.toFixed(2)}`);
  }

  return { todaySpent, cap };
}

// ============================================================================
// TWO-PASS ENRICHMENT LOGIC
// ============================================================================

/**
 * Estimate impact level from case metadata (heuristic for variation selection)
 */
function estimateImpactLevel(scotusCase) {
  const name = (scotusCase.case_name || '').toLowerCase();
  const syllabusOrExcerpt = (scotusCase.syllabus || scotusCase.opinion_excerpt || '').toLowerCase();
  const combined = `${name} ${syllabusOrExcerpt}`;

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

  return 3;
}

/**
 * Enrich a single SCOTUS case using two-pass architecture
 */
async function enrichCase(supabase, openai, scotusCase, recentPatternIds, args) {
  const displayName = safeCaseName(scotusCase);
  console.log(`\n🤖 Enriching: ${displayName.substring(0, 60)}...`);
  console.log(`   ID: ${scotusCase.id} | Term: ${scotusCase.term || 'N/A'} | Decided: ${scotusCase.decided_at?.slice(0, 10) || 'N/A'}`);

  let totalCost = 0;
  let totalTokens = 0;

  // =========================================================================
  // PASS 0: Source Quality Gate
  // =========================================================================
  console.log(`   📋 Pass 0: Checking source quality...`);
  const pass0 = checkSourceQuality(scotusCase);

  if (!pass0.passed) {
    console.log(`   ⚠️ Pass 0 FAILED: ${pass0.low_confidence_reason}`);
    if (!args.dryRun) {
      await flagAndSkip(scotusCase.id, pass0, supabase);
    }
    return { success: false, skipped: true, reason: pass0.low_confidence_reason };
  }

  console.log(`   ✓ Pass 0: Source OK (${pass0.source_char_count} chars, anchors: ${pass0.contains_anchor_terms})`);

  const pass0Metadata = {
    source_char_count: pass0.source_char_count,
    contains_anchor_terms: pass0.contains_anchor_terms
  };

  // =========================================================================
  // PASS 1: Fact Extraction (with consensus check)
  // =========================================================================
  console.log(`   📋 Pass 1: Extracting facts${args.skipConsensus ? ' (consensus disabled)' : ''}...`);

  if (args.dryRun) {
    console.log(`   [DRY RUN] Would call GPT for fact extraction`);
    return { success: true, dryRun: true };
  }

  let facts;
  try {
    const { facts: extractedFacts, usage: pass1Usage } = await extractFactsWithConsensus(
      openai,
      scotusCase,
      pass0Metadata,
      args.skipConsensus
    );
    facts = extractedFacts;
    totalCost += calculateCost(pass1Usage);
    totalTokens += pass1Usage?.total_tokens || 0;

    console.log(`   ✓ Pass 1: ${pass1Usage?.total_tokens || 0} tokens`);
    console.log(`     Disposition: ${facts.disposition || 'null'} | Merits: ${facts.merits_reached}`);
    console.log(`     Confidence: ${facts.fact_extraction_confidence}`);
  } catch (err) {
    console.error(`   ❌ Pass 1 failed: ${err.message}`);
    await markFailed(scotusCase.id, `Pass 1 error: ${err.message}`, supabase);
    return { success: false, error: err.message };
  }

  // Compute case_type BEFORE checking confidence (needed for Pass 2 constraints)
  facts.case_type = deriveCaseType(facts, scotusCase.case_name);
  console.log(`     Case Type: ${facts.case_type}`);

  // Check if Pass 1 confidence is too low
  if (facts.fact_extraction_confidence === 'low') {
    console.log(`   ⚠️ Pass 1 confidence LOW: ${facts.low_confidence_reason}`);
    await flagAndSkip(scotusCase.id, facts, supabase);
    return { success: false, skipped: true, reason: facts.low_confidence_reason, cost: totalCost };
  }

  // =========================================================================
  // PASS 2: Editorial Framing
  // =========================================================================
  console.log(`   📋 Pass 2: Applying editorial framing...`);

  // Select variation for creative direction
  const estimatedLevel = estimateImpactLevel(scotusCase);
  const poolType = getPoolType(estimatedLevel, scotusCase.issue_area);
  const variation = selectVariation(poolType, recentPatternIds);
  const variationInjection = buildVariationInjection(variation, []);
  const patternId = variation.opening?.id || 'unknown';

  console.log(`     Pool: ${poolType} | Pattern: ${patternId}`);

  let editorial;
  try {
    const messages = buildPass2Messages(scotusCase, facts, variationInjection);
    const { parsed: pass2Result, usage: pass2Usage } = await callGPTWithRetry(
      openai,
      messages,
      { temperature: 0.7, maxRetries: 1 }
    );

    editorial = pass2Result;
    totalCost += calculateCost(pass2Usage);
    totalTokens += pass2Usage?.total_tokens || 0;

    console.log(`   ✓ Pass 2: ${pass2Usage?.total_tokens || 0} tokens`);
  } catch (err) {
    console.error(`   ❌ Pass 2 failed: ${err.message}`);
    await markFailed(scotusCase.id, `Pass 2 error: ${err.message}`, supabase);
    return { success: false, error: err.message, cost: totalCost };
  }

  // Validate editorial response structure
  const { valid, errors } = validateEnrichmentResponse(editorial);
  if (!valid) {
    console.error(`   ❌ Pass 2 validation failed: ${errors.join(', ')}`);
    await markFailed(scotusCase.id, `Pass 2 validation: ${errors.join(', ')}`, supabase);
    return { success: false, error: errors.join(', '), cost: totalCost };
  }

  // =========================================================================
  // DRIFT VALIDATION
  // =========================================================================
  console.log(`   📋 Checking for drift...`);
  const driftCheck = validateNoDrift(facts, editorial);

  if (driftCheck.severity === 'hard') {
    console.log(`   ❌ HARD drift detected: ${driftCheck.reason}`);
    await flagAndSkip(scotusCase.id, {
      fact_extraction_confidence: 'low',
      low_confidence_reason: `Hard drift: ${driftCheck.reason}`,
      source_char_count: facts.source_char_count,
      contains_anchor_terms: facts.contains_anchor_terms,
      drift_detected: true,
      drift_reason: driftCheck.reason,
    }, supabase);
    return { success: false, skipped: true, reason: `Drift: ${driftCheck.reason}`, cost: totalCost };
  }

  // Determine publishing rules
  let isPublic = facts.fact_extraction_confidence === 'high';
  let needsReview = facts.fact_extraction_confidence === 'medium';

  if (driftCheck.severity === 'soft') {
    console.log(`   ⚠️ Soft drift detected: ${driftCheck.reason}`);
    isPublic = false;
    needsReview = true;
    facts.drift_detected = true;
    facts.drift_reason = `Soft drift: ${driftCheck.reason}`;
  } else {
    console.log(`   ✓ No drift detected`);
  }

  // =========================================================================
  // WRITE TO DATABASE
  // =========================================================================
  console.log(`   📋 Writing to database...`);

  await writeEnrichment(scotusCase.id, scotusCase, {
    ...facts,
    ...editorial,
    needs_manual_review: needsReview,
    is_public: isPublic
  }, supabase);

  // Track cost
  await incrementBudgetAtomic(supabase, totalCost);

  console.log(`   ✅ Enriched! (${totalTokens} tokens, $${totalCost.toFixed(4)})`);
  console.log(`   Level: ${editorial.ruling_impact_level} (${editorial.ruling_label})`);
  console.log(`   Public: ${isPublic} | Review: ${needsReview}`);
  console.log(`   Who wins: ${(editorial.who_wins || '').substring(0, 50)}...`);

  return {
    success: true,
    patternId,
    poolType,
    level: editorial.ruling_impact_level,
    confidence: facts.fact_extraction_confidence,
    caseType: facts.case_type,
    tokens: totalTokens,
    cost: totalCost,
    isPublic,
    needsReview
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = parseArgs();

  console.log(`\n🔍 SCOTUS Enrichment Script (ADO-280: Two-Pass)`);
  console.log(`================================================`);
  console.log(`Batch size: ${args.limit}`);
  console.log(`Dry run: ${args.dryRun}`);
  console.log(`Allow PROD: ${args.allowProd}`);
  console.log(`Skip consensus: ${args.skipConsensus}`);
  console.log(`Prompt version: ${PROMPT_VERSION}\n`);

  // Validate OpenAI key
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Missing OPENAI_API_KEY environment variable');
    process.exit(1);
  }

  // Get Supabase config
  const dbConfig = getSupabaseConfig(args.allowProd);
  if (!dbConfig) {
    console.error('❌ Missing Supabase environment variables');
    console.error('   Need: SUPABASE_TEST_URL + SUPABASE_TEST_SERVICE_KEY');
    console.error('   Or:   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (with --prod flag)');
    process.exit(1);
  }

  // Safety gate
  if (dbConfig.isProd && !args.dryRun && !args.allowProd) {
    console.error('❌ Refusing to write to PROD without --prod flag');
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

  // Warn if batch size exceeds safe limit
  if (args.limit > MAX_SAFE_LIMIT && !args.dryRun) {
    console.warn(`\n⚠️  Warning: Batch size ${args.limit} exceeds recommended max (${MAX_SAFE_LIMIT})`);
    console.warn(`   Press Ctrl+C within 5 seconds to abort...`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  // Query cases to enrich
  console.log(`\n📋 Querying cases (enrichment_status IN ['pending', 'failed'])...`);

  let cases;
  try {
    cases = await getCasesToEnrich(args.limit, supabase);
  } catch (error) {
    console.error(`\n❌ Query failed: ${error.message}`);
    process.exit(1);
  }

  if (!cases || cases.length === 0) {
    console.log('\n✅ No cases to enrich.');
    console.log('   (Cases need enrichment_status=pending/failed AND syllabus/excerpt)\n');
    return;
  }

  console.log(`\n📋 Found ${cases.length} case(s) to enrich\n`);

  // Process cases
  const recentPatternIds = [];
  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;
  let totalCost = 0;

  const results = {
    high: 0,
    medium: 0,
    low: 0,
    public: 0,
    review: 0
  };

  for (const scotusCase of cases) {
    try {
      const result = await enrichCase(supabase, openai, scotusCase, recentPatternIds, args);

      if (result.success) {
        successCount++;
        if (result.patternId) {
          recentPatternIds.push(result.patternId);
          if (recentPatternIds.length > 10) recentPatternIds.shift();
        }
        if (result.cost) totalCost += result.cost;

        // Track confidence distribution
        if (result.confidence === 'high') results.high++;
        else if (result.confidence === 'medium') results.medium++;

        if (result.isPublic) results.public++;
        if (result.needsReview) results.review++;
      } else if (result.skipped) {
        skipCount++;
        results.low++;
        if (result.cost) totalCost += result.cost;
      } else {
        failCount++;
        if (result.cost) totalCost += result.cost;
      }
    } catch (error) {
      console.error(`   ❌ Unexpected error: ${error.message}`);
      failCount++;
    }

    // Small delay between cases
    if (!args.dryRun) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Summary
  console.log(`\n📊 Summary`);
  console.log(`   Successful: ${successCount} (high: ${results.high}, medium: ${results.medium})`);
  console.log(`   Skipped (low confidence): ${skipCount}`);
  console.log(`   Failed (errors): ${failCount}`);
  console.log(`   Auto-published: ${results.public}`);
  console.log(`   Needs review: ${results.review}`);
  if (!args.dryRun && totalCost > 0) {
    console.log(`   Total cost: $${totalCost.toFixed(4)}`);
  }
  console.log('');
}

// Run
main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
