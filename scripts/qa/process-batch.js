#!/usr/bin/env node
/**
 * QA Batch Worker (ADO-310)
 *
 * Node worker that processes pending QA batch items.
 * Runs on a schedule via GitHub Actions (every 10 minutes).
 *
 * Features:
 * - Claims items via qa_claim_pending_batch_items RPC (SKIP LOCKED)
 * - Computes input_hash for idempotency (skips if unchanged)
 * - Runs Layer A + Layer B QA using existing modules
 * - Updates qa_batch_items with results and cost_usd
 * - Marks batch complete when all items done
 *
 * Environment:
 *   SUPABASE_URL or SUPABASE_TEST_URL
 *   SUPABASE_SERVICE_ROLE_KEY or SUPABASE_TEST_SERVICE_KEY
 *   OPENAI_API_KEY
 *   QA_CLAIM_LIMIT (optional, default: 10)
 *   QA_LAYER_B_MODEL (optional, default: gpt-4o-mini)
 *   QA_PROMPT_VERSION (optional, default: scotus_qa_v1)
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import crypto from 'crypto';
import dotenv from 'dotenv';

// Import QA modules
import {
  runDeterministicValidators,
  deriveVerdict,
  extractSourceExcerpt,
} from '../enrichment/scotus-qa-validators.js';

import {
  runLayerBQA,
  computeFinalVerdict,
  LAYER_B_PROMPT_VERSION,
  LAYER_B_MODEL,
} from '../enrichment/scotus-qa-layer-b.js';

dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_TEST_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_TEST_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const CLAIM_LIMIT = parseInt(process.env.QA_CLAIM_LIMIT || '10');
const MODEL = process.env.QA_LAYER_B_MODEL || LAYER_B_MODEL;
const PROMPT_VERSION = process.env.QA_PROMPT_VERSION || LAYER_B_PROMPT_VERSION;

// Cost estimate per Layer B call (gpt-4o-mini)
const COST_PER_QA = 0.0004;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Compute input hash for idempotency check.
 * Hash of summary + holding + evidence to detect if content changed.
 */
function computeInputHash(caseData) {
  const content = JSON.stringify({
    summary_spicy: caseData.summary_spicy,
    holding: caseData.holding,
    evidence_quotes: caseData.evidence_quotes,
    ruling_impact_level: caseData.ruling_impact_level,
    ruling_label: caseData.ruling_label,
  });
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Check if this case was already QA'd with same content.
 */
async function wasAlreadyProcessed(contentId, inputHash) {
  const { data, error } = await supabase
    .from('qa_batch_items')
    .select('id')
    .eq('content_id', contentId)
    .eq('input_hash', inputHash)
    .eq('status', 'completed')
    .limit(1);

  if (error) return false;
  return data && data.length > 0;
}

/**
 * Fetch case data needed for QA.
 */
async function fetchCaseData(contentId) {
  const { data, error } = await supabase
    .from('scotus_cases')
    .select(`
      id,
      case_name,
      summary_spicy,
      ruling_impact_level,
      ruling_label,
      holding,
      practical_effect,
      evidence_quotes,
      disposition,
      prevailing_party,
      qa_verdict,
      qa_issues
    `)
    .eq('id', contentId)
    .single();

  if (error) throw new Error(`Failed to fetch case: ${error.message}`);
  return data;
}

/**
 * Run QA on a case (Layer A + Layer B).
 */
async function runQA(caseData) {
  const startTime = Date.now();

  // Run Layer A (deterministic validators)
  const layerAResult = runDeterministicValidators(
    caseData.summary_spicy || '',
    {
      holding: caseData.holding,
      practical_effect: caseData.practical_effect,
      evidence_quotes: caseData.evidence_quotes || [],
      ruling_impact_level: caseData.ruling_impact_level,
      ruling_label: caseData.ruling_label,
    }
  );
  const layerAVerdict = deriveVerdict(layerAResult.issues);

  // Build grounding for Layer B
  const grounding = {
    holding: caseData.holding,
    practical_effect: caseData.practical_effect,
    evidence_quotes: caseData.evidence_quotes || [],
    source_excerpt: extractSourceExcerpt(caseData),
  };

  const facts = {
    disposition: caseData.disposition,
    prevailing_party: caseData.prevailing_party,
  };

  // Run Layer B (LLM QA)
  const layerBResult = await runLayerBQA(openai, {
    summary_spicy: caseData.summary_spicy,
    ruling_impact_level: caseData.ruling_impact_level,
    ruling_label: caseData.ruling_label,
    grounding,
    facts,
  });

  // Compute final verdict
  const finalVerdict = computeFinalVerdict(layerAVerdict, layerBResult.verdict);

  // Merge issues
  const allIssues = [
    ...layerAResult.issues.map(i => ({ ...i, layer: 'A' })),
    ...layerBResult.issues.map(i => ({ ...i, layer: 'B' })),
  ];

  return {
    verdict: finalVerdict,
    issues: allIssues,
    layerAVerdict,
    layerBVerdict: layerBResult.verdict,
    confidence: layerBResult.confidence,
    latency_ms: Date.now() - startTime,
    prompt_version: PROMPT_VERSION,
    model: MODEL,
  };
}

/**
 * Update batch item with result.
 */
async function updateItem(itemId, result, inputHash, costUsd) {
  const { error } = await supabase
    .from('qa_batch_items')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      qa_verdict: result.verdict,
      qa_issues: result.issues,
      input_hash: inputHash,
      prompt_version: result.prompt_version,
      model: result.model,
      latency_ms: result.latency_ms,
      cost_usd: costUsd,
    })
    .eq('id', itemId);

  if (error) throw new Error(`Failed to update item: ${error.message}`);
}

/**
 * Update batch item with error.
 */
async function updateItemError(itemId, errorMessage) {
  const { error } = await supabase
    .from('qa_batch_items')
    .update({
      status: 'error',
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
    })
    .eq('id', itemId);

  if (error) console.error(`Failed to update item error: ${error.message}`);
}

/**
 * Update batch item as skipped.
 */
async function updateItemSkipped(itemId, inputHash) {
  const { error } = await supabase
    .from('qa_batch_items')
    .update({
      status: 'skipped',
      completed_at: new Date().toISOString(),
      input_hash: inputHash,
      cost_usd: 0,
    })
    .eq('id', itemId);

  if (error) console.error(`Failed to update item skipped: ${error.message}`);
}

/**
 * Check if batch is complete and update status.
 */
async function checkBatchCompletion(batchId) {
  // Count pending/processing items
  const { count: pendingCount, error: pendingError } = await supabase
    .from('qa_batch_items')
    .select('*', { count: 'exact', head: true })
    .eq('batch_id', batchId)
    .in('status', ['pending', 'processing']);

  if (pendingError) {
    console.error(`Failed to check pending: ${pendingError.message}`);
    return;
  }

  if (pendingCount === 0) {
    // All items done, mark batch complete
    // Only update if batch is still in pending/running state (prevent overwriting cancelled/failed)
    const { error: updateError } = await supabase
      .from('qa_batches')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', batchId)
      .in('status', ['pending', 'running']);

    if (updateError) {
      console.error(`Failed to complete batch: ${updateError.message}`);
    } else {
      console.log(`Batch ${batchId} completed`);
    }
  }
}

/**
 * Update case with QA results (optional - for dashboard visibility).
 */
async function updateCaseQA(contentId, result) {
  const { error } = await supabase
    .from('scotus_cases')
    .update({
      qa_layer_b_verdict: result.layerBVerdict,
      qa_layer_b_issues: result.issues.filter(i => i.layer === 'B'),
      qa_layer_b_confidence: result.confidence,
      qa_layer_b_ran_at: new Date().toISOString(),
      qa_layer_b_prompt_version: result.prompt_version,
      qa_layer_b_model: result.model,
      qa_layer_b_latency_ms: result.latency_ms,
    })
    .eq('id', contentId);

  if (error) {
    console.warn(`Failed to update case QA: ${error.message}`);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('QA Batch Worker starting...');
  console.log(`Claim limit: ${CLAIM_LIMIT}`);

  // Claim pending items
  const { data: items, error: claimError } = await supabase
    .rpc('qa_claim_pending_batch_items', { p_limit: CLAIM_LIMIT });

  if (claimError) {
    console.error(`Failed to claim items: ${claimError.message}`);
    process.exit(1);
  }

  if (!items || items.length === 0) {
    console.log('No pending items to process');
    return;
  }

  console.log(`Claimed ${items.length} items`);

  const stats = {
    processed: 0,
    skipped: 0,
    errors: 0,
    totalCost: 0,
  };

  // Track batches for completion check
  const batchIds = new Set();

  for (const item of items) {
    batchIds.add(item.batch_id);

    try {
      // Fetch case data
      const caseData = await fetchCaseData(item.content_id);

      // Compute input hash
      const inputHash = computeInputHash(caseData);

      // Check if already processed with same content
      if (await wasAlreadyProcessed(item.content_id, inputHash)) {
        console.log(`[${item.id}] Case ${item.content_id}: Skipped (unchanged)`);
        await updateItemSkipped(item.id, inputHash);
        stats.skipped++;
        continue;
      }

      // Run QA
      console.log(`[${item.id}] Case ${item.content_id}: Running QA...`);
      const result = await runQA(caseData);

      // Update item
      await updateItem(item.id, result, inputHash, COST_PER_QA);

      // Also update case (for dashboard visibility)
      await updateCaseQA(item.content_id, result);

      console.log(`[${item.id}] Case ${item.content_id}: ${result.verdict} (${result.latency_ms}ms)`);
      stats.processed++;
      stats.totalCost += COST_PER_QA;

    } catch (err) {
      console.error(`[${item.id}] Case ${item.content_id}: Error - ${err.message}`);
      await updateItemError(item.id, err.message);
      stats.errors++;
    }
  }

  // Check batch completions
  for (const batchId of batchIds) {
    await checkBatchCompletion(batchId);
  }

  // Summary
  console.log('\nSummary:');
  console.log(`  Processed: ${stats.processed}`);
  console.log(`  Skipped: ${stats.skipped}`);
  console.log(`  Errors: ${stats.errors}`);
  console.log(`  Est. Cost: $${stats.totalCost.toFixed(4)}`);
}

main().catch(err => {
  console.error('Worker failed:', err.message);
  process.exit(1);
});
