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
  sanitizeForDB,
  getSourceText,           // ADO-300
  clampAndLabel,           // ADO-300
  enforceEditorialConstraints,  // ADO-300
} from '../enrichment/scotus-fact-extraction.js';

import {
  validateNoDrift
} from '../enrichment/scotus-drift-validation.js';

import {
  validateEnrichmentResponse,
  buildPass2Messages
} from '../enrichment/scotus-gpt-prompt.js';

import {
  selectFrame,
  selectVariation,
  buildVariationInjection,
  validateSummarySpicy,
  repairBannedStarter,
  extractSignatureSentence,
  getScotusContentId,
  SCOTUS_SECTION_BANS,
  PROMPT_VERSION as STYLE_PROMPT_VERSION
} from '../enrichment/scotus-style-patterns.js';

dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const PROMPT_VERSION = STYLE_PROMPT_VERSION;  // v4-ado275 from scotus-style-patterns.js
const DEFAULT_BATCH_SIZE = 10;
const MAX_SAFE_LIMIT = 100;
const DEFAULT_DAILY_CAP_USD = 5.00;

// OpenAI pricing (gpt-4o-mini as of 2025-01-01)
const INPUT_COST_PER_1K = 0.00015;
const OUTPUT_COST_PER_1K = 0.0006;

// ADO-300: Retry ladder config
// Default chain: gpt-5-mini (best accuracy) → gpt-4o-mini (fallback) → gpt-4o (last resort)
const FACTS_MODEL_FALLBACKS = (process.env.SCOTUS_FACTS_MODEL_FALLBACKS || 'gpt-5-mini,gpt-4o-mini,gpt-4o')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

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

// NOTE: estimateImpactLevel() removed in ADO-275. Frame selection now handled by
// selectFrame() in scotus-style-patterns.js using priority chain:
// clamp_reason → inferIssueOverride() → Pass1 facts → estimateFrameFromMetadata()

/**
 * ADO-300: Check Pass 1 facts for issues that warrant retry with stronger model
 * @param {Object} facts - Pass 1 output
 * @returns {string[]} List of issue codes
 */
function getFactsIssues(facts) {
  const issues = [];
  if (!facts) return ['no_facts'];

  if (!facts.disposition) issues.push('missing_disposition');

  const eq = facts.evidence_quotes || [];
  if (!Array.isArray(eq) || eq.length === 0) issues.push('missing_evidence');

  const typeRaw = (facts.case_type || '').toLowerCase();
  const prevailing = (facts.prevailing_party || 'unknown').toLowerCase();

  // Stage mismatch: cert/procedural shouldn't have clear winner
  if ((typeRaw === 'cert_stage' || typeRaw === 'procedural') &&
      prevailing !== 'unknown' && prevailing !== 'unclear') {
    issues.push('stage_mismatch');
  }

  return issues;
}

/**
 * Enrich a single SCOTUS case using two-pass architecture
 */
async function enrichCase(supabase, openai, scotusCase, recentPatternIds, recentOpenings, args) {
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
      // ADO-300: Set clamp_reason for missing_text
      await flagAndSkip(scotusCase.id, pass0, supabase, {
        clamp_reason: 'missing_text',
        publish_override: false,
      });
    }
    return { success: false, skipped: true, reason: pass0.low_confidence_reason };
  }

  console.log(`   ✓ Pass 0: Source OK (${pass0.source_char_count} chars, anchors: ${pass0.contains_anchor_terms})`);

  const pass0Metadata = {
    source_char_count: pass0.source_char_count,
    contains_anchor_terms: pass0.contains_anchor_terms
  };

  // =========================================================================
  // PASS 1: Fact Extraction (with retry ladder - ADO-300)
  // =========================================================================
  console.log(`   📋 Pass 1: Extracting facts${args.skipConsensus ? ' (consensus disabled)' : ''}...`);

  if (args.dryRun) {
    console.log(`   [DRY RUN] Would call GPT for fact extraction`);
    return { success: true, dryRun: true };
  }

  // ADO-300: Retry ladder for Pass 1
  let facts = null;
  let usedModel = 'gpt-4o-mini';
  let retry_reason = null;

  for (const model of FACTS_MODEL_FALLBACKS) {
    usedModel = model;
    console.log(`   📋 Pass 1: Trying ${model}...`);

    try {
      const { facts: extractedFacts, usage: pass1Usage } = await extractFactsWithConsensus(
        openai,
        scotusCase,
        { ...pass0Metadata, facts_model_override: model },
        args.skipConsensus
      );

      totalCost += calculateCost(pass1Usage);
      totalTokens += pass1Usage?.total_tokens || 0;

      // Compute case_type early for issue detection
      extractedFacts.case_type = deriveCaseType(extractedFacts, scotusCase.case_name);

      // Check for issues that warrant retry
      const issues = getFactsIssues(extractedFacts);

      // ADO-300: stage_mismatch is clampable (cert/procedural posture vs winner). Do not fail Pass 1 on it.
      const fatalIssues = issues.filter(i => i !== 'stage_mismatch');

      if (fatalIssues.length === 0) {
        facts = extractedFacts;

        // Keep full issues string for telemetry if we accepted a clampable mismatch.
        retry_reason = issues.length ? issues.join(',') : null;

        console.log(`   ✓ Pass 1 (${model}): ${pass1Usage?.total_tokens || 0} tokens`);
        console.log(`     Disposition: ${facts.disposition || 'null'} | Merits: ${facts.merits_reached}`);
        console.log(`     Case Type: ${facts.case_type} | Confidence: ${facts.fact_extraction_confidence}`);
        if (retry_reason) console.log(`     (telemetry) Pass 1 issues accepted: ${retry_reason}`);
        break;
      }

      retry_reason = fatalIssues.join(',');
      console.log(`   ⚠️ Issues with ${model}: ${retry_reason}`);
    } catch (err) {
      console.log(`   ⚠️ ${model} failed: ${err.message}`);
      retry_reason = `error:${err.message.slice(0, 50)}`;
    }
  }

  // ADO-300: All models failed - mark as failed (retry-able, not terminal)
  if (!facts) {
    console.error(`   ❌ All models failed for Pass 1`);
    await markFailed(scotusCase.id, `Pass 1 all models failed: ${retry_reason}`, supabase);
    return { success: false, error: retry_reason, cost: totalCost };
  }

  // Check if Pass 1 confidence is too low (after successful extraction)
  if (facts.fact_extraction_confidence === 'low') {
    console.log(`   ⚠️ Pass 1 confidence LOW: ${facts.low_confidence_reason}`);
    await flagAndSkip(scotusCase.id, facts, supabase, {
      facts_model_used: usedModel,
      retry_reason: retry_reason,
    });
    return { success: false, skipped: true, reason: facts.low_confidence_reason, cost: totalCost };
  }

  // =========================================================================
  // ADO-300: CLAMP AND LABEL POST-PROCESSING
  // =========================================================================
  // Get source text for reliable pattern detection
  const sourceText = getSourceText(scotusCase);
  const clampedFacts = clampAndLabel(facts, { sourceText });

  console.log(`   Clamp: ${clampedFacts.clamp_reason || 'none'} | Sidestepping forbidden: ${clampedFacts._sidestepping_forbidden}`);
  if (clampedFacts.clamp_reason) {
    console.log(`   📋 Clamped case will get Sidestepping label`);
  }

  // =========================================================================
  // PASS 2: Editorial Framing (ADO-275: New Variation System)
  // =========================================================================
  console.log(`   📋 Pass 2: Applying editorial framing...`);

  // ADO-275: Select frame using priority order (clamp → issue → facts → metadata)
  const { frame, poolKey, frameSource } = selectFrame(clampedFacts, scotusCase);
  const caseContentId = getScotusContentId(scotusCase);
  const variation = selectVariation(poolKey, caseContentId, PROMPT_VERSION, recentPatternIds);

  // Validate variation was selected
  if (!variation || !variation.id) {
    console.error(`   ❌ Failed to select variation for poolKey=${poolKey}`);
    await markFailed(scotusCase.id, `Variation selection failed for pool ${poolKey}`, supabase);
    return { success: false, error: `Variation selection failed`, cost: totalCost };
  }

  const variationInjection = buildVariationInjection(variation, frame, clampedFacts.clamp_reason);
  const patternId = variation.id;

  console.log(`     Frame: ${frame} (${frameSource}) | Pool: ${poolKey} | Pattern: ${patternId}`);

  let editorial;
  try {
    // ADO-300: Pass clampedFacts (with label_policy) to Pass 2
    const messages = buildPass2Messages(scotusCase, clampedFacts, variationInjection);
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
  // ADO-275: POST-GEN VALIDATION (banned starters + duplicate detection)
  // =========================================================================
  console.log(`   📋 Checking for banned starters/duplicates...`);
  const recentSignatures = recentOpenings.map(o => extractSignatureSentence(o));
  const { valid: spicyValid, reason: spicyReason, matchedPattern, isDuplicate } =
    validateSummarySpicy(editorial.summary_spicy, recentSignatures);

  if (!spicyValid) {
    console.log(`   ⚠️ summary_spicy validation failed: ${spicyReason}`);

    // Attempt repair for banned starters (not duplicates)
    if (matchedPattern && !isDuplicate) {
      const repairResult = repairBannedStarter('summary_spicy', editorial.summary_spicy, matchedPattern);
      if (repairResult.success) {
        console.log(`   ✓ Repaired banned starter`);
        editorial.summary_spicy = repairResult.content;
      } else {
        console.log(`   ⚠️ Repair failed: ${repairResult.reason} - marking needs_review`);
        editorial._banned_starter_detected = true;
        editorial._banned_starter_reason = spicyReason;
        // Will be caught by needsReview logic below
      }
    } else if (isDuplicate) {
      console.log(`   ⚠️ Duplicate signature detected - marking needs_review`);
      editorial._duplicate_detected = true;
      // Don't auto-publish items with duplicate signatures
    }
  } else {
    console.log(`   ✓ No banned starters or duplicates`);
  }

  // =========================================================================
  // DRIFT VALIDATION + ADO-300: ENFORCE CONSTRAINTS
  // =========================================================================
  console.log(`   📋 Checking for drift...`);
  const driftCheck = validateNoDrift(clampedFacts, editorial);

  // ADO-300: Apply enforceEditorialConstraints (may override editorial based on clamp/drift)
  const constrainedEditorial = enforceEditorialConstraints(clampedFacts, editorial, driftCheck);

  // ADO-300: For clamped cases, drift is handled by constraint enforcement, not blocking
  if (driftCheck.severity === 'hard' && !clampedFacts.clamp_reason) {
    // Only block on hard drift if NOT a clamped case (clamped cases are rescued by constraints)
    console.log(`   ❌ HARD drift detected: ${driftCheck.reason}`);
    await flagAndSkip(scotusCase.id, {
      fact_extraction_confidence: 'low',
      low_confidence_reason: `Hard drift: ${driftCheck.reason}`,
      source_char_count: clampedFacts.source_char_count,
      contains_anchor_terms: clampedFacts.contains_anchor_terms,
      drift_detected: true,
      drift_reason: driftCheck.reason,
    }, supabase, {
      facts_model_used: usedModel,
      retry_reason: retry_reason,
    });
    return { success: false, skipped: true, reason: `Drift: ${driftCheck.reason}`, cost: totalCost };
  }

  // ADO-300: Determine publishing rules with publish_override support
  let isPublic = clampedFacts.fact_extraction_confidence === 'high' ||
                 clampedFacts.publish_override === true;
  let needsReview = clampedFacts.fact_extraction_confidence === 'medium' &&
                    !clampedFacts.publish_override;

  // ADO-275: Don't auto-publish if banned starter or duplicate detected
  if (editorial._banned_starter_detected || editorial._duplicate_detected) {
    if (!clampedFacts.publish_override) {
      isPublic = false;
      needsReview = true;
    }
  }

  if (driftCheck.severity === 'soft') {
    console.log(`   ⚠️ Soft drift detected: ${driftCheck.reason}`);
    if (!clampedFacts.publish_override) {
      isPublic = false;
      needsReview = true;
    }
    clampedFacts.drift_detected = true;
    clampedFacts.drift_reason = `Soft drift: ${driftCheck.reason}`;
  } else if (driftCheck.severity === 'hard' && clampedFacts.clamp_reason) {
    // Clamped case with hard drift - rescued by constraints
    console.log(`   ⚠️ Hard drift rescued by clamp: ${driftCheck.reason}`);
    clampedFacts.drift_detected = true;
    clampedFacts.drift_reason = `Hard drift (clamped): ${driftCheck.reason}`;
  } else {
    console.log(`   ✓ No drift detected`);
  }

  // =========================================================================
  // WRITE TO DATABASE
  // =========================================================================
  console.log(`   📋 Writing to database...`);

  await writeEnrichment(scotusCase.id, scotusCase, {
    ...clampedFacts,
    ...constrainedEditorial,
    facts_model_used: usedModel,
    retry_reason: retry_reason,
    needs_manual_review: needsReview,
    is_public: isPublic
  }, supabase);

  // Track cost
  await incrementBudgetAtomic(supabase, totalCost);

  console.log(`   ✅ Enriched! (${totalTokens} tokens, $${totalCost.toFixed(4)}, model: ${usedModel})`);
  console.log(`   Level: ${constrainedEditorial.ruling_impact_level} (${constrainedEditorial.ruling_label})`);
  console.log(`   Public: ${isPublic} | Review: ${needsReview} | Clamp: ${clampedFacts.clamp_reason || 'none'}`);
  console.log(`   Who wins: ${(constrainedEditorial.who_wins || '').substring(0, 50)}...`);

  return {
    success: true,
    patternId,
    poolKey,  // ADO-275: renamed from poolType
    frame,    // ADO-275: frame bucket
    frameSource,  // ADO-275: how frame was determined
    level: constrainedEditorial.ruling_impact_level,
    confidence: clampedFacts.fact_extraction_confidence,
    caseType: clampedFacts.case_type,
    clampReason: clampedFacts.clamp_reason,
    tokens: totalTokens,
    cost: totalCost,
    isPublic,
    needsReview,
    // For anti-repetition: track summary_spicy for signature detection
    summaryOpening: (constrainedEditorial.summary_spicy || '').substring(0, 150)
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = parseArgs();

  console.log(`\n🔍 SCOTUS Enrichment Script (ADO-275: Tone Variation + ADO-300: Clamp/Retry)`);
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
  const recentOpenings = [];  // Track recent summary_spicy openings for anti-repetition
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
      const result = await enrichCase(supabase, openai, scotusCase, recentPatternIds, recentOpenings, args);

      if (result.success) {
        successCount++;
        if (result.patternId) {
          recentPatternIds.push(result.patternId);
          if (recentPatternIds.length > 10) recentPatternIds.shift();
        }
        // Track recent summary openings for anti-repetition
        if (result.summaryOpening) {
          recentOpenings.push(result.summaryOpening);
          if (recentOpenings.length > 10) recentOpenings.shift();
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
