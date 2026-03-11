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
 *   node scripts/scotus/enrich-scotus.js --case-ids=145,161,230  # Enrich specific cases (ADO-323)
 *   node scripts/scotus/enrich-scotus.js --force-gold          # Allow re-enriching gold set cases (ADO-394)
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
  lintQuotes,              // ADO-303
  computeSeverityBounds,   // ADO-446: Re-run after reconciliation
} from '../enrichment/scotus-fact-extraction.js';

import {
  validateNoDrift
} from '../enrichment/scotus-drift-validation.js';

import {
  validateEnrichmentResponse,
  validateFactGrounding,
  buildPass2Messages,
  lintGenericParties
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

// ADO-308: QA validators for deterministic quality checks
// ADO-309: Added hasFixableIssues, buildQAFixDirectives for retry logic
import {
  runDeterministicValidators,
  deriveVerdict,
  extractSourceExcerpt,
  hasFixableIssues,
  buildQAFixDirectives,
} from '../enrichment/scotus-qa-validators.js';

// ADO-429: SCOTUSblog grounding agent
import {
  getScotusContext,
  formatContextForPrompt,
  validateAgainstContext,
} from './scotusblog-scraper.js';

// ADO-310: Layer B LLM QA for nuanced quality checks
import {
  runLayerBQA,
  computeFinalVerdict,
  buildCombinedFixDirectives,
} from '../enrichment/scotus-qa-layer-b.js';

dotenv.config();

// ADO-308: Feature flag for QA gate
// - false (default): Shadow mode - writes QA data but doesn't block enrichment
// - true: Enabled mode - REJECT blocks write, FLAG sets is_public=false
const ENABLE_QA_GATE = process.env.ENABLE_QA_GATE === 'true';

// ADO-309: TEST-ONLY flag to force a REJECT on attempt 0 for E2E retry validation
// Set FORCE_QA_REJECT_TEST=true to inject a fake procedural_merits_implication issue
// This proves the retry loop works end-to-end. Remove after validation.
const FORCE_QA_REJECT_TEST = process.env.FORCE_QA_REJECT_TEST === 'true';

// ADO-310: Layer B LLM QA configuration
// LAYER_B_MODE controls Layer B behavior:
// - 'off' (default): Skip Layer B entirely (no LLM call, no columns written)
// - 'shadow': Run Layer B, write columns, but don't affect qa_status/is_public
// - 'enforce': Run Layer B, write columns, AND use verdict for qa_status/is_public
const LAYER_B_MODE = process.env.LAYER_B_MODE || 'off';

// LAYER_B_RETRY: When true (and mode=enforce), retry Pass 2 if Layer B REJECT with fixable issues
// Only meaningful when LAYER_B_MODE=enforce
const LAYER_B_RETRY = process.env.LAYER_B_RETRY === 'true';

// ============================================================================
// ADO-438: SIMPLIFIED PIPELINE BYPASS FLAGS
// ============================================================================
// Bypass old QA/validation layers. Set to 'false' to re-enable for rollback.
// After v9 stable, bypassed code will be deleted in a cleanup session.

const SCOTUS_SKIP_CONSENSUS = process.env.SCOTUS_SKIP_CONSENSUS !== 'false';      // default: true (single Pass 1)
const SCOTUS_SKIP_DRIFT = process.env.SCOTUS_SKIP_DRIFT !== 'false';              // default: true (skip drift validation)
const SCOTUS_SKIP_QA_VALIDATORS = process.env.SCOTUS_SKIP_QA_VALIDATORS !== 'false'; // default: true (skip Layer A)
const SCOTUS_SKIP_LAYER_B = process.env.SCOTUS_SKIP_LAYER_B !== 'false';          // default: true (skip Layer B)
const PASS2_TEMPERATURE = parseFloat(process.env.SCOTUS_PASS2_TEMPERATURE ?? '0.7');
// Note: QA retry loop removed structurally (not bypassed). The retry loop depended on
// all validators + Layer B running, and had 0% trigger rate. Setting the above flags
// to false re-enables validators/drift/Layer B but without the retry wrapper.

// ============================================================================
// CONFIGURATION
// ============================================================================

const PROMPT_VERSION = STYLE_PROMPT_VERSION;  // v4-ado275 from scotus-style-patterns.js
const DEFAULT_BATCH_SIZE = 10;
const MAX_SAFE_LIMIT = 100;
const DEFAULT_DAILY_CAP_USD = 5.00;

// OpenAI pricing per 1K tokens
const MODEL_PRICING = {
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4o':      { input: 0.0025,  output: 0.01 },
};
const INPUT_COST_PER_1K = 0.00015;   // default fallback (mini)
const OUTPUT_COST_PER_1K = 0.0006;   // default fallback (mini)

// ADO-303: Model config (Phase 0 - gpt-4o-mini only)
// Rationale: gpt-5-mini produced quote-heavy output causing 5/6 low-confidence failures
// Fallback chain disabled by default; can re-enable via env var if needed
const FACTS_MODEL_FALLBACKS = (process.env.SCOTUS_FACTS_MODEL_FALLBACKS || 'gpt-4o-mini')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// ADO-429: Pass 2 model — GPT-4o for better reasoning with SCOTUSblog grounding
// Override via SCOTUS_PASS2_MODEL env var (defaults to gpt-4o)
const PASS2_MODEL = process.env.SCOTUS_PASS2_MODEL || 'gpt-4o';

// ADO-303: Max retries for empty responses (same model, smaller context)
const MAX_EMPTY_RETRIES = 2;

// ============================================================================
// PARSE CLI ARGUMENTS
// ============================================================================

function parseArgs() {
  const args = {
    limit: DEFAULT_BATCH_SIZE,
    dryRun: false,
    allowProd: false,
    skipConsensus: false,
    caseIds: null,  // ADO-323: Targeted case IDs for regression testing
    forceGold: false,  // ADO-394: Allow re-enriching gold set cases
    noScotusblog: false,  // ADO-429: Disable SCOTUSblog grounding
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
    } else if (arg === '--force-gold') {
      args.forceGold = true;
    } else if (arg === '--no-scotusblog') {
      args.noScotusblog = true;
    } else if (arg.startsWith('--case-ids=')) {
      // ADO-323: Parse comma-separated case IDs with dedupe + order preserved
      const raw = arg.split('=')[1] || '';
      const parsed = raw
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => Number.isFinite(n));
      const seen = new Set();
      args.caseIds = parsed.filter(id => (seen.has(id) ? false : (seen.add(id), true)));
    } else if (!isNaN(parseInt(arg, 10))) {
      args.limit = parseInt(arg, 10);
    }
  }

  return args;
}

// ============================================================================
// ADO-323: TARGETED CASE FETCH BY IDS
// ============================================================================

/**
 * Fetch specific cases by ID for targeted regression testing.
 * Preserves the requested order for deterministic runs.
 *
 * @param {number[]} ids - Array of case IDs to fetch
 * @param {Object} supabase - Supabase client
 * @returns {Promise<Object[]>} Cases in requested order
 */
async function getCasesToEnrichByIds(ids, supabase) {
  const { data, error } = await supabase
    .from('scotus_cases')
    .select(`
      *,
      scotus_opinions!left(opinion_full_text)
    `)
    .in('id', ids);

  if (error) throw error;

  // Flatten the LEFT JOIN result (same as getCasesToEnrich)
  const flattened = (data || []).map(row => {
    const joined = row.scotus_opinions;
    const opinion_full_text = Array.isArray(joined)
      ? joined[0]?.opinion_full_text
      : joined?.opinion_full_text;

    return {
      ...row,
      opinion_full_text: opinion_full_text || null,
      scotus_opinions: undefined
    };
  });

  // Preserve requested order for determinism
  const byId = new Map(flattened.map(row => [row.id, row]));
  return ids.map(id => byId.get(id)).filter(Boolean);
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
// ADO-303: POST-GEN REPAIRS (deterministic, no LLM calls)
// ============================================================================

/**
 * Split case caption into party names
 * Handles: "A v. B", but NOT "In re X" (returns null)
 */
function splitCaseCaption(caseName) {
  const parts = String(caseName || '').split(/\s+v\.?\s+/i);
  if (parts.length < 2) return null;

  const clean = (s) =>
    String(s || '')
      .replace(/\s+/g, ' ')
      .replace(/\s*\(.*?\)\s*$/, '')  // strip trailing parenthetical
      .replace(/,\s*(et al\.?|et\s+al)\s*$/i, '')
      .trim();

  const partyA = clean(parts[0]);
  const partyB = clean(parts.slice(1).join(' v. '));  // handle extra splits

  if (!partyA || !partyB) return null;
  return { partyA, partyB };
}

/**
 * Repair generic "petitioner/respondent" with actual party names
 * Only expands if NOT already annotated (avoids double-insert)
 */
function repairGenericParty(text, caseName) {
  const cap = splitCaseCaption(caseName);
  if (!cap) return text;

  const { partyA, partyB } = cap;

  // Only expand if NOT already like "petitioner (X)"
  const petitionerRe = /\b(the\s+)?petitioner(s)?\b(?!\s*\()/gi;
  const respondentRe = /\b(the\s+)?respondent(s)?\b(?!\s*\()/gi;

  return String(text || '')
    .replace(petitionerRe, (_m, _the, plural) =>
      plural ? `the petitioners (${partyA})` : `the petitioner (${partyA})`
    )
    .replace(respondentRe, (_m, _the, plural) =>
      plural ? `the respondents (${partyB})` : `the respondent (${partyB})`
    );
}

/**
 * Apply party repair to all user-visible text fields
 */
function applyPartyRepair(editorial, caseName) {
  const fieldsToRepair = [
    'summary_spicy', 'who_wins', 'who_loses', 'why_it_matters',
    'holding', 'practical_effect', 'dissent_highlights'
  ];

  let repaired = false;
  for (const field of fieldsToRepair) {
    if (editorial[field] && typeof editorial[field] === 'string') {
      const original = editorial[field];
      const fixed = repairGenericParty(original, caseName);
      if (fixed !== original) {
        editorial[field] = fixed;
        repaired = true;
      }
    }
  }
  return repaired;
}

/**
 * Deterministic "In a..." opener fixer (no LLM call)
 * Rewrites first sentence if it starts with common journalist crutches
 */
function rewriteInAOpener(summary) {
  const s = String(summary || '').trim();
  if (!s) return { text: s, rewritten: false };

  // Split first sentence (simple, deterministic)
  const m = s.match(/^(.+?[.!?])(\s+|$)([\s\S]*)$/);
  if (!m) return { text: s, rewritten: false };

  let first = m[1];
  const rest = (m[3] || '').trim();
  const originalFirst = first;

  // 1) "In a 6-3 decision, ..." -> "By a 6-3 vote, ..."
  first = first.replace(
    /^In a\s+(\d+)\s*[–-]\s*(\d+)\s+decision,\s*/i,
    'By a $1–$2 vote, '
  );

  // 2) "In an opinion by Justice X, ..." -> "Justice X wrote for the Court, ..."
  first = first.replace(
    /^In an?\s+opinion\s+(?:by|written by)\s+([^,]+),\s*/i,
    '$1 wrote for the Court, '
  );

  // 3) Generic "In a/an/this/the ..." -> "The Court ..." (fallback)
  if (/^In (a|an|this|the)\b/i.test(first)) {
    // Check for existing legal subjects that would make "The Court" redundant
    const hasLegalSubject = /\b(the Court|the justices|the Supreme Court|the majority|the Chief Justice|Justice \w+)\b/i.test(first);
    if (hasLegalSubject) {
      // Already has a legal subject after the comma, just drop the lead-in
      first = first.replace(/^In (a|an|this|the)\b[^,]*,\s*/i, '');
      first = first.charAt(0).toUpperCase() + first.slice(1);
    } else {
      first = first.replace(/^In (a|an|this|the)\b[^,]*,\s*/i, 'The Court ');
    }
  }

  const rewritten = first !== originalFirst;
  const text = rest ? `${first} ${rest}` : first;
  return { text, rewritten };
}

// ============================================================================
// ADO-438: INVARIANT CHECKER (replaces ~1,700 lines of QA validators)
// ============================================================================

/**
 * One-way disposition synonym map: editorial synonyms → canonical disposition.
 * "struck down" normalizes TO "reversed", etc.
 * One-way prevents accidental passes from fuzzy matching.
 */
const DISPOSITION_SYNONYM_MAP = {
  'overturned': 'reversed', 'struck down': 'reversed', 'tossed out': 'reversed',
  'upheld': 'affirmed', 'left intact': 'affirmed', 'left standing': 'affirmed',
    'backed': 'affirmed', 'sustained': 'affirmed', 'stands': 'affirmed',
  'set aside': 'vacated', 'invalidated': 'vacated', 'nullified': 'vacated',
    'wiped out': 'vacated', 'thrown out': 'vacated',
  'sent back': 'remanded', 'returned to': 'remanded',
  'rejected': 'dismissed', 'tossed': 'dismissed',
};

/**
 * Run 7 invariant checks on enrichment output.
 * Returns array of failure objects: { code, detail }.
 * Non-blocking — failures log as warnings, set enrichment_status='flagged'.
 *
 * @param {Object} facts - Clamped Pass 1 output
 * @param {Object} editorial - Post-processed Pass 2 output
 * @param {Object} LEVEL_TO_LABEL - Level→label mapping
 * @returns {{ passed: boolean, failures: Array<{code: string, detail: string}> }}
 */
function runInvariantChecks(facts, editorial, LEVEL_TO_LABEL) {
  const failures = [];

  // 1. who_wins !== who_loses
  if (editorial.who_wins && editorial.who_loses &&
      editorial.who_wins.trim().toLowerCase() === editorial.who_loses.trim().toLowerCase()) {
    failures.push({ code: 'invariant_winner_loser', detail: `who_wins === who_loses: "${editorial.who_wins}"` });
  }

  // 2. Disposition term in summary (normalized synonym matching)
  if (facts.disposition && editorial.summary_spicy && facts.case_type === 'merits') {
    const summaryLower = editorial.summary_spicy.toLowerCase();
    const canonicalDisp = facts.disposition.toLowerCase();

    // Check if canonical disposition or any synonym mapping TO it appears in summary
    const synonymsForCanonical = Object.entries(DISPOSITION_SYNONYM_MAP)
      .filter(([, canonical]) => canonical === canonicalDisp)
      .map(([synonym]) => synonym);
    const termsToCheck = [canonicalDisp, ...synonymsForCanonical];
    const found = termsToCheck.some(term => summaryLower.includes(term));

    if (!found) {
      failures.push({ code: 'invariant_disposition', detail: `Disposition "${facts.disposition}" (or synonym) not in summary` });
    }
  }

  // 3. No merits claim on procedural/cert case
  if (facts.case_type && facts.case_type !== 'merits') {
    const meritsLanguage = /\b(held that|found that|ruled that|struck down|upheld|invalidated|overturned|established|prevailed)\b/i;
    if (meritsLanguage.test(editorial.summary_spicy || '')) {
      failures.push({ code: 'invariant_procedural', detail: `Merits language in ${facts.case_type} case` });
    }
  }

  // 4. Dissent highlights null when no dissent
  if (facts.dissent_exists === false && editorial.dissent_highlights) {
    failures.push({ code: 'invariant_dissent_null', detail: 'dissent_highlights non-null but no dissent exists' });
  }

  // 5. Evidence anchors array is non-empty
  if (!Array.isArray(editorial.evidence_anchors) || editorial.evidence_anchors.length === 0) {
    failures.push({ code: 'invariant_anchors', detail: 'evidence_anchors is empty or not an array' });
  }

  // 6. Required editorial fields non-empty
  const requiredFields = ['summary_spicy', 'who_wins', 'who_loses', 'why_it_matters'];
  for (const field of requiredFields) {
    if (!editorial[field] || (typeof editorial[field] === 'string' && editorial[field].trim().length === 0)) {
      failures.push({ code: 'invariant_fields_empty', detail: `Required field "${field}" is empty` });
    }
  }

  // 7. Severity label matches numeric level
  if (typeof editorial.ruling_impact_level === 'number' && LEVEL_TO_LABEL[editorial.ruling_impact_level]) {
    const expectedLabel = LEVEL_TO_LABEL[editorial.ruling_impact_level];
    if (editorial.ruling_label !== expectedLabel) {
      failures.push({ code: 'invariant_level_label', detail: `Level ${editorial.ruling_impact_level} → expected "${expectedLabel}" but got "${editorial.ruling_label}"` });
    }
  }

  return { passed: failures.length === 0, failures };
}

// ============================================================================
// ADO-303: CERT GRANT/DENIAL DETECTION (Skip non-merits cases)
// ============================================================================

/**
 * Detect if a case is a cert grant/denial (not a merits decision)
 * These should be skipped - they have no merits outcome to summarize
 *
 * @param {Object} scotusCase - Case object with opinion_excerpt, syllabus
 * @returns {{ isCert: boolean, certType: string|null, reason: string|null }}
 */
function detectCertCase(scotusCase) {
  // Normalize: remove hyphenated line breaks (e.g., "de-\nnied" → "denied")
  const sourceText = [
    scotusCase.opinion_excerpt || '',
    scotusCase.syllabus || ''
  ].join(' ')
    .replace(/-\s*\n\s*/g, '')  // Remove hyphenated line breaks
    .replace(/\s+/g, ' ')        // Normalize whitespace
    .toLowerCase();

  // Cert denial patterns (most common)
  const certDeniedPatterns = [
    /petition\s+for\s+(a\s+)?writ\s+of\s+certiorari\s+is\s+denied/i,
    /certiorari\s+denied/i,
    /cert\.\s*denied/i,
  ];

  // Cert granted patterns (case pending decision)
  const certGrantedPatterns = [
    /petition\s+for\s+(a\s+)?writ\s+of\s+certiorari\s+is\s+granted/i,
    /certiorari\s+granted/i,
    /cert\.\s*granted/i,
  ];

  // Check for cert denied
  for (const pattern of certDeniedPatterns) {
    if (pattern.test(sourceText)) {
      return {
        isCert: true,
        certType: 'cert_denied',
        reason: 'Cert denied - no merits decision'
      };
    }
  }

  // Check for cert granted (pending)
  for (const pattern of certGrantedPatterns) {
    if (pattern.test(sourceText)) {
      // But make sure it's not a merits decision that mentions cert was granted
      const hasMeritsDisposition = /\b(affirm(ed|s)?|revers(ed|es)?|vacat(ed|es)?)\b.*\bjudgment\b/i.test(sourceText);
      if (!hasMeritsDisposition) {
        return {
          isCert: true,
          certType: 'cert_granted',
          reason: 'Cert granted - pending merits decision'
        };
      }
    }
  }

  return { isCert: false, certType: null, reason: null };
}

// ============================================================================
// SAFETY HELPERS
// ============================================================================

function safeCaseName(scotusCase) {
  const raw = (scotusCase?.case_name || '').trim();
  return raw.length > 0 ? raw : `[Unnamed case ID=${scotusCase?.id || 'unknown'}]`;
}

function calculateCost(usage, model = 'gpt-4o-mini') {
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gpt-4o-mini'];
  const inputCost = (promptTokens / 1000) * pricing.input;
  const outputCost = (completionTokens / 1000) * pricing.output;
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
 * ADO-303: Run publish gate checks on Pass 1 facts and Pass 2 editorial
 * Returns validation result with issues list
 *
 * Note: Quote lint changed to truncate+telemetry (no longer a hard gate)
 *
 * @param {Object} facts - Pass 1 output (clamped)
 * @param {Object} editorial - Pass 2 output
 * @returns {{ valid: boolean, issues: string[], quoteTelemetry: string[] }}
 */
function runPublishGate(facts, editorial) {
  const issues = [];

  // 1. Quote lint: truncate+telemetry (NOT a failure condition)
  // Quotes are not user-facing; truncation preserves grounding without false failures
  const quoteLint = lintQuotes(facts?.evidence_quotes);
  if (quoteLint.truncated) {
    console.log(`   📊 [quote telemetry] ${quoteLint.telemetry.join('; ')}`);
  }

  // 2. Disposition check for merits cases
  const caseType = (facts?.case_type || '').toLowerCase();
  const isMerits = caseType === 'merits' || facts?.merits_reached === true;

  if (isMerits) {
    if (!facts?.disposition) {
      issues.push('[merits] Missing disposition for merits case');
    }

    // Check disposition mentioned early in summary_spicy (first 200 chars)
    const summaryStart = (editorial?.summary_spicy || '').slice(0, 200).toLowerCase();
    const disp = (facts?.disposition || '').toLowerCase();
    if (disp && !summaryStart.includes(disp)) {
      // Soft warning - don't block on this
      console.log(`   ⚠️ [gate] Disposition "${disp}" not in summary_spicy opening`);
    }
  }

  // 3. Generic party lint on Pass 2 who_wins/who_loses
  // Skip for clamped cases (they have procedural boilerplate)
  if (!facts?.clamp_reason) {
    const partyLint = lintGenericParties(editorial);
    if (!partyLint.valid) {
      issues.push(...partyLint.issues.map(i => `[party] ${i}`));
    }
  }

  return {
    valid: issues.length === 0,
    issues
    // Note: Retry for gate failures not implemented in Phase 0
    // Cases that fail gate are quarantined for manual review
  };
}

// ============================================================================
// ADO-446: RECONCILIATION — Cross-check Pass 1 (GPT) vs SCOTUSblog grounding
// ============================================================================

/**
 * Cross-check Pass 1 facts against SCOTUSblog grounding data.
 * May auto-correct: vote_split, dissent_authors (+dissent_exists), case_type.
 * NEVER auto-corrects: disposition, holding, who_wins/who_loses, summary, severity.
 *
 * @param {Object} clampedFacts - Facts from clampAndLabel()
 * @param {Object} scotusCase - DB case record (has dissent_authors from backfill)
 * @param {Object|null} scotusblogResult - Result from getScotusContext()
 * @returns {{ corrections: Array<{field, outcome, reason, old?, new?}>, mutatedFacts: Object }}
 */
function reconcileWithScotusblog(clampedFacts, scotusCase, scotusblogResult) {
  const corrections = [];

  // No SCOTUSblog data → nothing to cross-check
  if (!scotusblogResult || !scotusblogResult.found || !scotusblogResult.caseData) {
    corrections.push({ field: 'all', outcome: 'no_scotusblog', reason: 'SCOTUSblog data unavailable' });
    return { corrections, mutatedFacts: clampedFacts };
  }

  const sbData = scotusblogResult.caseData;

  // --- Vote split cross-check ---
  const sbVote = (sbData.vote_split || '').replace(/\s+/g, '');
  const gptVote = (clampedFacts.vote_split || '').replace(/\s+/g, '');

  if (sbVote && gptVote) {
    const sbNorm = sbVote.replace(/[^0-9-]/g, '');
    const gptNorm = gptVote.replace(/[^0-9-]/g, '');
    if (sbNorm === gptNorm) {
      corrections.push({ field: 'vote_split', outcome: 'no_change', reason: 'GPT and SCOTUSblog agree' });
    } else {
      const oldVal = clampedFacts.vote_split;
      clampedFacts.vote_split = sbData.vote_split;
      corrections.push({
        field: 'vote_split', outcome: 'auto_corrected_vote_split',
        reason: `SCOTUSblog preferred over GPT`, old: oldVal, new: sbData.vote_split
      });
    }
  } else if (sbVote && !gptVote) {
    clampedFacts.vote_split = sbData.vote_split;
    corrections.push({
      field: 'vote_split', outcome: 'auto_corrected_vote_split',
      reason: 'GPT had no vote_split, using SCOTUSblog', old: null, new: sbData.vote_split
    });
  }

  // --- Dissent cross-check (Bug 1) ---
  // Parse minority count from effective vote_split
  // Only auto-correct dissent when vote_split is verified by SCOTUSblog (not GPT-only)
  const voteVerifiedByScotusblog = sbVote !== '';
  const effectiveVote = clampedFacts.vote_split || '';
  const voteMatch = effectiveVote.match(/(\d+)\s*[-–]\s*(\d+)/);
  const minorityCount = voteMatch ? parseInt(voteMatch[2], 10) : 0;
  const gptDissent = clampedFacts.dissent_authors || [];
  const dbDissent = scotusCase.dissent_authors || [];

  if (voteVerifiedByScotusblog && minorityCount > 0 && gptDissent.length === 0) {
    // Split vote but GPT missed dissenters
    if (dbDissent.length > 0) {
      // DB backfill has names → auto-correct
      const oldVal = [...gptDissent];
      clampedFacts.dissent_authors = [...dbDissent];
      clampedFacts.dissent_exists = true;
      corrections.push({
        field: 'dissent_authors', outcome: 'auto_corrected_dissent',
        reason: `Vote ${effectiveVote} implies ${minorityCount} dissenters; filled from DB backfill`,
        old: oldVal, new: [...dbDissent]
      });
    } else {
      // No source has names → flag for manual review
      corrections.push({
        field: 'dissent_authors', outcome: 'flagged_dissent',
        reason: `Vote ${effectiveVote} implies ${minorityCount} dissenters but no source has names`
      });
    }
  } else if (!voteVerifiedByScotusblog && minorityCount > 0 && gptDissent.length === 0) {
    // Vote split not verified by SCOTUSblog — can't trust minority count for auto-correct
    corrections.push({ field: 'dissent_authors', outcome: 'no_change', reason: 'Vote split unverified (GPT-only) — skipping dissent cross-check' });
  } else if (minorityCount === 0 && gptDissent.length === 0) {
    corrections.push({ field: 'dissent_authors', outcome: 'no_change', reason: 'Unanimous or no minority — consistent' });
  } else {
    corrections.push({ field: 'dissent_authors', outcome: 'no_change', reason: 'Dissent data already present' });
  }

  // --- Disposition cross-check (FLAG only, never auto-correct) ---
  const gptDisp = (clampedFacts.disposition || '').toLowerCase();
  const sbHolding = (sbData.holding || '').toLowerCase();
  if (gptDisp && sbHolding) {
    // Check for gross disagreement (GPT says affirmed, SCOTUSblog says reversed, etc.)
    const dispSignals = { affirm: /affirm/i, reverse: /revers/i, vacate: /vacat/i, remand: /remand/i, dismiss: /dismiss/i };
    const gptSignal = Object.entries(dispSignals).find(([, rx]) => rx.test(gptDisp))?.[0] || null;
    const sbSignal = Object.entries(dispSignals).find(([, rx]) => rx.test(sbHolding))?.[0] || null;

    if (gptSignal && sbSignal && gptSignal !== sbSignal) {
      // Only flag if they actively disagree (both present, different)
      // Exception: vacate+remand are compatible
      const compatible = (gptSignal === 'vacate' && sbSignal === 'remand') ||
                         (gptSignal === 'remand' && sbSignal === 'vacate');
      if (!compatible) {
        corrections.push({
          field: 'disposition', outcome: 'flagged_disposition_disagree',
          reason: `GPT: "${gptDisp}" vs SCOTUSblog holding: "${sbHolding.slice(0, 100)}"`
        });
      }
    }
  }

  // --- Case-type cross-check (Bug 2) ---
  if (clampedFacts.case_type === 'unclear') {
    const disp = (clampedFacts.disposition || '').toLowerCase();
    const isVacatedOrRemanded = /vacat|remand/i.test(disp);
    const isPurelyProcedural = /\b(dismiss|moot)\b/i.test(disp);

    if (isVacatedOrRemanded && !isPurelyProcedural) {
      // Check for compound merits signals in SCOTUSblog text
      const sbText = ((sbData.holding || '') + ' ' + (scotusblogResult.analysisText || '')).toLowerCase();
      const meritsKeywords = ['held', 'ruled', 'struck down', 'upheld', 'invalidated', 'overruled'];
      const meritsHits = meritsKeywords.filter(kw => sbText.includes(kw));

      if (meritsHits.length >= 2) {
        // Strong merits signals → auto-correct
        const oldVal = clampedFacts.case_type;
        clampedFacts.case_type = 'merits';
        corrections.push({
          field: 'case_type', outcome: 'auto_corrected_case_type',
          reason: `V&R with ${meritsHits.length} merits signals: [${meritsHits.join(', ')}]`,
          old: oldVal, new: 'merits'
        });
      } else {
        // Insufficient signals → flag
        corrections.push({
          field: 'case_type', outcome: 'flagged_case_type',
          reason: `V&R case_type=unclear, only ${meritsHits.length} merits signal(s): [${meritsHits.join(', ')}]`
        });
      }
    }
  }

  // If no corrections were logged for case_type, mark as no_change
  if (!corrections.some(c => c.field === 'case_type')) {
    corrections.push({ field: 'case_type', outcome: 'no_change', reason: 'case_type consistent or not unclear' });
  }

  return { corrections, mutatedFacts: clampedFacts };
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
  // ADO-303: CERT SKIP (before any GPT calls - saves cost)
  // =========================================================================
  const certCheck = detectCertCase(scotusCase);
  if (certCheck.isCert) {
    console.log(`   ⏭️ Skipping: ${certCheck.reason}`);
    if (!args.dryRun) {
      await flagAndSkip(scotusCase.id, {
        low_confidence_reason: certCheck.reason,
        case_type: certCheck.certType,
      }, supabase, {
        clamp_reason: certCheck.certType,
        publish_override: false,
      });
    }
    return { success: false, skipped: true, reason: certCheck.reason, certSkip: true };
  }

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
  // PASS 1: Fact Extraction (ADO-303: single model with empty retry)
  // =========================================================================
  // ADO-438: Force consensus skip when bypass flag is set
  const effectiveSkipConsensus = args.skipConsensus || SCOTUS_SKIP_CONSENSUS;
  console.log(`   📋 Pass 1: Extracting facts${effectiveSkipConsensus ? ' (consensus disabled)' : ''}...`);

  if (args.dryRun) {
    console.log(`   [DRY RUN] Would call GPT for fact extraction`);
    return { success: true, dryRun: true };
  }

  // ADO-303: Single model with retry-on-empty/issues (up to MAX_EMPTY_RETRIES)
  const model = FACTS_MODEL_FALLBACKS[0] || 'gpt-4o-mini';
  let facts = null;
  let usedModel = model;
  let retry_reason = null;
  let retryCount = 0;

  while (retryCount <= MAX_EMPTY_RETRIES) {
    const isRetry = retryCount > 0;
    if (isRetry) {
      console.log(`   📋 Pass 1: Retry ${retryCount}/${MAX_EMPTY_RETRIES} (${model})...`);
    } else {
      console.log(`   📋 Pass 1: Trying ${model}...`);
    }

    try {
      const { facts: extractedFacts, usage: pass1Usage } = await extractFactsWithConsensus(
        openai,
        scotusCase,
        { ...pass0Metadata, facts_model_override: model },
        effectiveSkipConsensus
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

      // Fatal issues found - retry if we have attempts left
      retry_reason = fatalIssues.join(',');
      console.log(`   ⚠️ Issues: ${retry_reason}`);
      retryCount++;

    } catch (err) {
      console.log(`   ⚠️ ${model} failed: ${err.message}`);
      retry_reason = `error:${err.message.slice(0, 50)}`;
      retryCount++;
    }
  }

  // ADO-303: All retries exhausted - mark as failed
  if (!facts) {
    console.error(`   ❌ Pass 1 failed after ${retryCount} retries`);
    await markFailed(scotusCase.id, `Pass 1 failed: ${retry_reason}`, supabase);
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
  const clampedFacts = clampAndLabel(facts, { sourceText, scotusCase });

  // ADO-428: Inject dissent metadata from DB for phantom dissent null-coercion
  clampedFacts.dissent_exists = (scotusCase.dissent_authors?.length || 0) > 0;
  clampedFacts.dissent_authors = scotusCase.dissent_authors || [];

  console.log(`   Clamp: ${clampedFacts.clamp_reason || 'none'} | Sidestepping forbidden: ${clampedFacts._sidestepping_forbidden}`);
  console.log(`   Severity bounds: min=${clampedFacts.severity_bounds?.min}, max=${clampedFacts.severity_bounds?.max} (${clampedFacts.severity_bounds?.reason || 'none'})`);
  console.log(`   Issue area: ${clampedFacts.issue_area || 'null'} | Dissent: ${(scotusCase.dissent_authors || []).join(', ') || 'none'}`);
  if (clampedFacts.clamp_reason) {
    console.log(`   📋 Clamped case will get Sidestepping label`);
  }

  // =========================================================================
  // ADO-429: SCOTUSBLOG GROUNDING (between Pass 1 and Pass 2)
  // Fetch context from SCOTUSblog for fact-grounded editorial writing.
  // =========================================================================
  let scotusblogContext = '';
  let scotusblogResult = null;

  if (!args.noScotusblog) {
    console.log(`   📋 SCOTUSblog: Searching for grounding context...`);
    try {
      scotusblogResult = await getScotusContext({
        caseName: scotusCase.case_name,
        docketNumber: scotusCase.docket_number,
        term: scotusCase.term,
      });

      if (scotusblogResult.found) {
        scotusblogContext = formatContextForPrompt(scotusblogResult);
        const contextLen = scotusblogContext.length;
        const strategy = scotusblogResult.searchStrategy;
        const hasAnalysis = !!scotusblogResult.analysisText;
        console.log(`   ✓ SCOTUSblog: Found (${strategy}, ${contextLen} chars, analysis: ${hasAnalysis})`);

        // ADO-438: Store vote_split from SCOTUSblog to DB (if available and not already set)
        const sbVoteSplit = scotusblogResult.caseData?.vote_split;
        if (sbVoteSplit && !args.dryRun) {
          const updatePayload = {
            scotusblog_vote_split: sbVoteSplit,
            vote_split_source: 'scotusblog',
          };
          // Also populate vote_split if it's currently empty
          if (!scotusCase.vote_split) {
            updatePayload.vote_split = sbVoteSplit;
          }
          const { error: vsError } = await supabase
            .from('scotus_cases')
            .update(updatePayload)
            .eq('id', scotusCase.id);
          if (vsError) {
            console.log(`   ⚠️ Vote split DB update failed: ${vsError.message}`);
          } else {
            console.log(`   ✓ Stored vote_split: ${sbVoteSplit} (source: scotusblog)`);
            // Update in-memory case for downstream severity bounds
            scotusCase.scotusblog_vote_split = sbVoteSplit;
            scotusCase.vote_split_source = 'scotusblog';
            if (!scotusCase.vote_split) scotusCase.vote_split = sbVoteSplit;
          }
        }
      } else {
        console.log(`   ⚠️ SCOTUSblog: Not found for "${scotusCase.case_name}"`);
        if (scotusblogResult.errors.length > 0) {
          console.log(`      Errors: ${scotusblogResult.errors.join('; ')}`);
        }
      }
    } catch (err) {
      console.log(`   ⚠️ SCOTUSblog fetch failed (non-blocking): ${err.message}`);
    }
  }

  // =========================================================================
  // ADO-446: RECONCILIATION — Cross-check Pass 1 vs SCOTUSblog
  // Insert corrections for vote_split, dissent_authors, case_type.
  // Must happen BEFORE Pass 2 so editorial sees corrected facts.
  // =========================================================================
  const { corrections: reconciliationCorrections } =
    reconcileWithScotusblog(clampedFacts, scotusCase, scotusblogResult);

  // Log reconciliation outcomes
  const autoCorrections = reconciliationCorrections.filter(c =>
    c.outcome.startsWith('auto_corrected') || c.outcome.startsWith('flagged'));
  if (autoCorrections.length > 0) {
    console.log(`   🔄 Reconciliation: ${autoCorrections.length} correction(s)`);
    for (const c of autoCorrections) {
      console.log(`      ${c.field}: ${c.outcome} — ${c.reason}`);
    }

    // If dissent_authors or case_type changed, re-run severity bounds
    const dissentChanged = reconciliationCorrections.some(c =>
      c.field === 'dissent_authors' && c.outcome === 'auto_corrected_dissent');
    const caseTypeChanged = reconciliationCorrections.some(c =>
      c.field === 'case_type' && c.outcome === 'auto_corrected_case_type');

    if (dissentChanged || caseTypeChanged) {
      // Update scotusCase in-memory for severity recomputation + downstream validation
      if (dissentChanged) {
        scotusCase.dissent_authors = clampedFacts.dissent_authors;
        scotusCase.dissent_exists = true;
      }
      const isCert = clampedFacts.clamp_reason === 'cert_no_merits';
      const isProcedural = clampedFacts.clamp_reason === 'procedural_no_merits';
      const evidenceText = clampedFacts._evidence_text || '';
      const overrulePattern = /\b(we\s+(\w+\s+){0,3}overrule|(?:is|are|must\s+be)\s+(hereby\s+|expressly\s+|explicitly\s+)?overruled)\b/i;
      const declinePattern = /\b(decline[sd]?\s+to\s+overrule|not\s+overrul|need\s+not\s+overrule|without\s+overrul)\b/i;
      const explicitOverrule = overrulePattern.test(evidenceText) && !declinePattern.test(evidenceText);

      clampedFacts.severity_bounds = computeSeverityBounds(
        clampedFacts, scotusCase, { isCert, isProcedural, explicitOverrule }
      );
      console.log(`   🔄 Severity bounds recomputed: min=${clampedFacts.severity_bounds?.min}, max=${clampedFacts.severity_bounds?.max}`);
    }
  } else {
    console.log(`   ✓ Reconciliation: no corrections needed`);
  }

  // ADO-429: Select Pass 2 model — GPT-4o when grounding available, else mini
  const pass2Model = scotusblogContext ? PASS2_MODEL : 'gpt-4o-mini';
  console.log(`   Pass 2 model: ${pass2Model}${scotusblogContext ? ' (grounded)' : ' (ungrounded fallback)'}`);

  // =========================================================================
  // PASS 2: Editorial Framing (ADO-275: New Variation System)
  // ADO-309: Now includes QA retry loop (max 1 retry for fixable issues)
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

  const baseVariationInjection = buildVariationInjection(variation, frame, clampedFacts.clamp_reason);
  const patternId = variation.id;

  console.log(`     Frame: ${frame} (${frameSource}) | Pool: ${poolKey} | Pattern: ${patternId}`);

  // ADO-309: Helper to run Pass 2 with optional QA fix directives
  // ADO-429: Now passes SCOTUSblog context and uses selected model
  async function executePass2(qaFixDirectives = '') {
    const fullVariationInjection = qaFixDirectives
      ? `${baseVariationInjection}\n${qaFixDirectives}`
      : baseVariationInjection;

    const messages = buildPass2Messages(scotusCase, clampedFacts, fullVariationInjection, scotusblogContext);
    const { parsed: pass2Result, usage: pass2Usage } = await callGPTWithRetry(
      openai,
      messages,
      { temperature: PASS2_TEMPERATURE, maxRetries: 1, model: pass2Model }
    );

    return { editorial: pass2Result, usage: pass2Usage };
  }

  let editorial;
  let qaRetryCount = 0;
  const MAX_QA_RETRIES = 1;  // ADO-309: Hard limit on QA retries

  try {
    // Initial Pass 2 execution
    const { editorial: pass2Result, usage: pass2Usage } = await executePass2();

    editorial = pass2Result;
    totalCost += calculateCost(pass2Usage, pass2Model);
    totalTokens += pass2Usage?.total_tokens || 0;

    console.log(`   ✓ Pass 2: ${pass2Usage?.total_tokens || 0} tokens (${pass2Model})`);
  } catch (err) {
    console.error(`   ❌ Pass 2 failed: ${err.message}`);
    await markFailed(scotusCase.id, `Pass 2 error: ${err.message}`, supabase);
    return { success: false, error: err.message, cost: totalCost };
  }

  // ADO-303: Check for empty/null editorial before validation
  if (!editorial || typeof editorial !== 'object') {
    console.error(`   ❌ Pass 2 returned empty/invalid response`);
    await markFailed(scotusCase.id, `Pass 2 empty response`, supabase);
    return { success: false, error: 'Empty Pass 2 response', cost: totalCost };
  }

  // Validate editorial response structure (ADO-354: pass caseName for concrete fact checks)
  const { valid, errors } = validateEnrichmentResponse(editorial, { caseName: scotusCase.case_name, scotusCase });
  if (!valid) {
    console.error(`   ❌ Pass 2 validation failed: ${errors.join(', ')}`);
    await markFailed(scotusCase.id, `Pass 2 validation: ${errors.join(', ')}`, supabase);
    return { success: false, error: errors.join(', '), cost: totalCost };
  }

  // ADO-354: Grounding check — best-effort logging (retry wiring is follow-up)
  {
    const groundingCheck = validateFactGrounding(
      editorial.why_it_matters,
      sourceText,
      { holding: clampedFacts.holding, practical_effect: clampedFacts.practical_effect }
    );
    if (!groundingCheck.passed) {
      const suspicious = groundingCheck.suspicious.length > 3
        ? [...groundingCheck.suspicious.slice(0, 3), `(+${groundingCheck.suspicious.length - 3} more)`]
        : groundingCheck.suspicious;
      console.warn(`   ⚠️ ADO-354 grounding: suspicious citations not in source: ${suspicious.join(', ')}`);
    }
  }

  // =========================================================================
  // ADO-429: SCOTUSBLOG POST-ENRICHMENT VALIDATION
  // Compare enrichment output against SCOTUSblog data for factual consistency.
  // =========================================================================
  if (scotusblogResult && scotusblogResult.found) {
    const sbValidation = validateAgainstContext(editorial, scotusblogResult);
    const checkSummary = sbValidation.checks
      .filter(c => c.status !== 'skip')
      .map(c => `${c.field}:${c.status}`)
      .join(', ');
    console.log(`   📋 SCOTUSblog validation: ${sbValidation.passed ? 'PASS' : 'WARN'} (${checkSummary})`);
    if (sbValidation.hasWarnings) {
      for (const c of sbValidation.checks.filter(c => c.status === 'warn')) {
        console.log(`      ⚠️ ${c.field}: ${c.detail}`);
      }
    }
  }

  // =========================================================================
  // ADO-309: POST-GEN PROCESSING WITH QA RETRY LOOP
  // Process editorial output, run validations, and retry if fixable QA issues
  // =========================================================================

  // Build grounding object for QA validation (needed in loop)
  const grounding = {
    holding: clampedFacts.holding,
    practical_effect: clampedFacts.practical_effect,
    evidence_quotes: clampedFacts.evidence_quotes || [],
    source_excerpt: extractSourceExcerpt(scotusCase, 2400),
  };

  // Pre-compute recent signatures for banned starter check
  const recentSignatures = recentOpenings.map(o => extractSignatureSentence(o));

  // ADO-429: Level→label mapping (level is source of truth, label derived from it)
  // See docs/features/scotus-enrichment/severity-changelog.md for rationale
  const LEVEL_TO_LABEL = {
    0: 'Democracy Wins',
    1: 'Crumbs from the Bench',
    2: 'Judicial Sidestepping',
    3: 'Institutional Sabotage',
    4: 'Rubber-stamping Tyranny',
    5: 'Constitutional Crisis'
  };

  // Variables for post-processing
  let constrainedEditorial;
  let driftCheck;
  let gateResult;
  let qaIssues = [];       // Layer A issues
  let qaVerdict = 'APPROVE';      // Layer A verdict
  let qaStatus = 'approved';
  let isPublic;
  let needsReview;
  let qaFixDirectivesUsed = '';  // Track what fix directives we injected

  // ADO-310: Layer B variables
  let layerBResult = null;      // Full Layer B result object
  let layerBVerdict = null;     // Layer B verdict (APPROVE|FLAG|REJECT|null)
  let layerBIssues = [];        // Layer B issues
  let finalVerdict = null;      // Combined Layer A + B verdict
  let layerBRetryCount = 0;     // Separate counter for Layer B retries

  // ADO-438: Invariant check results
  let invariantResult = null;

  // =========================================================================
  // ADO-438: SIMPLIFIED POST-GEN PROCESSING (no retry loop)
  // When bypass flags are set, skip QA validators/drift/Layer B/retry.
  // Invariant checks replace the old validation stack.
  // When bypass flags are OFF, fall through to legacy path for rollback.
  // =========================================================================

  {
    // =========================================================================
    // ADO-275: POST-GEN VALIDATION (banned starters + duplicate detection)
    // (Always runs — this is a cheap deterministic repair, not QA)
    // =========================================================================
    console.log(`   📋 Checking for banned starters/duplicates...`);
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
        }
      } else if (isDuplicate) {
        console.log(`   ⚠️ Duplicate signature detected - marking needs_review`);
        editorial._duplicate_detected = true;
      }
    } else {
      console.log(`   ✓ No banned starters or duplicates`);
    }

    // =========================================================================
    // DRIFT VALIDATION + ADO-300: ENFORCE CONSTRAINTS
    // ADO-438: Bypass drift validation when SCOTUS_SKIP_DRIFT=true
    // =========================================================================
    if (SCOTUS_SKIP_DRIFT) {
      console.log(`   📋 Drift validation: BYPASSED (ADO-438)`);
      driftCheck = { severity: 'none', hasDrift: false, reason: null, hardIssues: [], softIssues: [] };
    } else {
      console.log(`   📋 Checking for drift...`);
      driftCheck = validateNoDrift(clampedFacts, editorial);
    }

    // ADO-300: Apply enforceEditorialConstraints (may override editorial based on clamp/drift)
    constrainedEditorial = enforceEditorialConstraints(clampedFacts, editorial, driftCheck);

    // =========================================================================
    // ADO-303: POST-GEN REPAIRS (deterministic, no LLM calls)
    // =========================================================================

    // #3: Party specificity repair - expand "petitioner/respondent" to actual names
    const partyRepaired = applyPartyRepair(constrainedEditorial, scotusCase.case_name);
    if (partyRepaired) {
      console.log(`   📝 Party repair: expanded generic petitioner/respondent`);
    }

    // #4: "In a..." opener fixer - deterministic rewrite of journalist crutch
    if (constrainedEditorial.summary_spicy) {
      const openerResult = rewriteInAOpener(constrainedEditorial.summary_spicy);
      if (openerResult.rewritten) {
        constrainedEditorial.summary_spicy = openerResult.text;
        console.log(`   📝 Opener repair: rewrote "In a..." opener`);
      }
    }

    // ADO-429: Apply severity bounds from clampAndLabel (caps/floors based on case characteristics)
    const rawLevel = constrainedEditorial.ruling_impact_level;
    const bounds = clampedFacts.severity_bounds || { min: 0, max: 5 };
    if (typeof rawLevel === 'number' && rawLevel >= 0 && rawLevel <= 5) {
      const boundedLevel = Math.max(bounds.min, Math.min(bounds.max, rawLevel));
      if (boundedLevel !== rawLevel) {
        console.log(`   [SEVERITY] Bounded ${rawLevel} → ${boundedLevel} (${bounds.reason || 'bounds'})`);
      }
      constrainedEditorial.ruling_impact_level = boundedLevel;
    }

    // ADO-429: Derive ruling_label from level (level is source of truth)
    if (typeof constrainedEditorial.ruling_impact_level === 'number' && LEVEL_TO_LABEL[constrainedEditorial.ruling_impact_level]) {
      constrainedEditorial.ruling_label = LEVEL_TO_LABEL[constrainedEditorial.ruling_impact_level];
    }

    // ADO-300/438: For clamped cases, drift is handled by constraint enforcement, not blocking
    if (!SCOTUS_SKIP_DRIFT && driftCheck.severity === 'hard' && !clampedFacts.clamp_reason) {
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
        qa_retry_count: qaRetryCount,
      });
      return { success: false, skipped: true, reason: `Drift: ${driftCheck.reason}`, cost: totalCost };
    }

    // =========================================================================
    // ADO-303: PUBLISH GATE (rule-based checks)
    // =========================================================================
    console.log(`   📋 Running publish gate...`);
    gateResult = runPublishGate(clampedFacts, constrainedEditorial);

    if (!gateResult.valid) {
      console.log(`   ⚠️ Gate issues: ${gateResult.issues.join(', ')}`);
    } else {
      console.log(`   ✓ Publish gate passed`);
    }

    // ADO-300: Determine publishing rules with publish_override support
    isPublic = clampedFacts.fact_extraction_confidence === 'high' ||
               clampedFacts.publish_override === true;
    needsReview = clampedFacts.fact_extraction_confidence === 'medium' &&
                  !clampedFacts.publish_override;

    // ADO-354: Non-merits cases (procedural, cert_stage, unclear) should not be public
    if (clampedFacts.case_type && clampedFacts.case_type !== 'merits') {
      isPublic = false;
      console.log(`   📋 Non-merits case_type (${clampedFacts.case_type}) → is_public=false`);
    }

    // ADO-303: Gate failures → quarantine
    if (!gateResult.valid && !clampedFacts.publish_override) {
      isPublic = false;
      needsReview = true;
      clampedFacts.low_confidence_reason = (clampedFacts.low_confidence_reason || '') +
        (clampedFacts.low_confidence_reason ? '; ' : '') +
        `Gate: ${gateResult.issues.join(', ')}`;
    }

    // ADO-275: Don't auto-publish if banned starter or duplicate detected
    if (editorial._banned_starter_detected || editorial._duplicate_detected) {
      if (!clampedFacts.publish_override) {
        isPublic = false;
        needsReview = true;
      }
    }

    if (!SCOTUS_SKIP_DRIFT) {
      if (driftCheck.severity === 'soft') {
        console.log(`   ⚠️ Soft drift detected: ${driftCheck.reason}`);
        if (!clampedFacts.publish_override) {
          isPublic = false;
          needsReview = true;
        }
        clampedFacts.drift_detected = true;
        clampedFacts.drift_reason = `Soft drift: ${driftCheck.reason}`;
      } else if (driftCheck.severity === 'hard' && clampedFacts.clamp_reason) {
        console.log(`   ⚠️ Hard drift rescued by clamp: ${driftCheck.reason}`);
        clampedFacts.drift_detected = true;
        clampedFacts.drift_reason = `Hard drift (clamped): ${driftCheck.reason}`;
      } else {
        console.log(`   ✓ No drift detected`);
      }
    }

    // =========================================================================
    // ADO-438: QA VALIDATORS — BYPASS OR RUN LEGACY
    // =========================================================================
    if (SCOTUS_SKIP_QA_VALIDATORS) {
      console.log(`   📋 QA validators: BYPASSED (ADO-438)`);
      qaVerdict = 'APPROVE';
      qaStatus = 'approved';
      qaIssues = [];
    } else {
      console.log(`   📋 Running QA validators...`);
      qaIssues = runDeterministicValidators({
        summary_spicy: constrainedEditorial.summary_spicy,
        ruling_impact_level: constrainedEditorial.ruling_impact_level,
        facts: clampedFacts,
        grounding,
      });
      qaVerdict = deriveVerdict(qaIssues);
      qaStatus = qaVerdict === 'APPROVE' ? 'approved' : qaVerdict === 'FLAG' ? 'flagged' : 'rejected';
      console.log(`   QA Verdict: ${qaVerdict} (${qaIssues.length} issues)`);
      if (qaIssues.length > 0) {
        console.log(`   QA Issues: ${qaIssues.map(i => i.type).join(', ')}`);
      }
    }

    // =========================================================================
    // ADO-438: LAYER B — BYPASS OR RUN LEGACY
    // =========================================================================
    if (SCOTUS_SKIP_LAYER_B || LAYER_B_MODE === 'off') {
      if (SCOTUS_SKIP_LAYER_B) {
        console.log(`   📋 Layer B: BYPASSED (ADO-438)`);
      } else {
        console.log(`   [Layer B disabled] Using Layer A verdict only`);
      }
      finalVerdict = qaVerdict;
    } else {
      console.log(`   📋 Running Layer B QA (mode: ${LAYER_B_MODE})...`);
      try {
        layerBResult = await runLayerBQA(openai, {
          summary_spicy: constrainedEditorial.summary_spicy,
          ruling_impact_level: constrainedEditorial.ruling_impact_level,
          ruling_label: constrainedEditorial.ruling_label,
          grounding,
          facts: clampedFacts,
        });
        layerBVerdict = layerBResult.verdict;
        layerBIssues = layerBResult.issues || [];
        totalCost += calculateCost(layerBResult.usage);
        finalVerdict = computeFinalVerdict(qaVerdict, layerBVerdict);
        console.log(`   Final Verdict: ${finalVerdict} (Layer A: ${qaVerdict}, Layer B: ${layerBVerdict ?? 'null'})`);
      } catch (err) {
        console.error(`   ⚠️ Layer B failed: ${err.message}`);
        finalVerdict = qaVerdict;
      }
    }

    // =========================================================================
    // ADO-438: INVARIANT CHECKS (replaces QA stack)
    // =========================================================================
    console.log(`   📋 Running invariant checks (ADO-438)...`);
    invariantResult = runInvariantChecks(clampedFacts, constrainedEditorial, LEVEL_TO_LABEL);

    if (invariantResult.passed) {
      console.log(`   ✓ All 7 invariants passed`);
    } else {
      console.log(`   ⚠️ Invariant failures (${invariantResult.failures.length}):`);
      for (const f of invariantResult.failures) {
        console.log(`      ${f.code}: ${f.detail}`);
      }
      // Invariant failures → flag for review (non-blocking)
      qaStatus = 'flagged';
      if (!clampedFacts.publish_override) {
        needsReview = true;
      }
    }

    // Apply QA gate if enabled (legacy path, only when bypass flags are off)
    if (!SCOTUS_SKIP_QA_VALIDATORS && ENABLE_QA_GATE) {
      const effectiveVerdict = finalVerdict ?? qaVerdict;
      if (effectiveVerdict === 'FLAG' && !clampedFacts.publish_override) {
        isPublic = false;
        needsReview = true;
      }
    }
  }

  // ADO-446: Reconciliation flags → needs_manual_review
  const hasFlaggedCorrections = reconciliationCorrections.some(c => c.outcome.startsWith('flagged_'));
  if (hasFlaggedCorrections) {
    needsReview = true;
    console.log(`   ⚠️ Reconciliation flagged items → needs_manual_review=true`);
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
    // ADO-446: Reconciliation corrections log
    reconciliation_corrections: reconciliationCorrections,
    is_public: isPublic,
    // ADO-308: QA columns (Layer A, always written)
    // ADO-309: Added qa_retry_count to track retry attempts
    qa_status: qaStatus,
    qa_verdict: qaVerdict,
    qa_issues: qaIssues,
    qa_retry_count: qaRetryCount,
    // ADO-438: Invariant check results
    ...(invariantResult ? {
      invariant_passed: invariantResult.passed,
      invariant_failures: invariantResult.failures.length > 0 ? invariantResult.failures : null,
    } : {}),
    // ADO-310: Layer B QA columns (written when LAYER_B_MODE != 'off', includes error states)
    ...(LAYER_B_MODE !== 'off' && !SCOTUS_SKIP_LAYER_B && layerBResult ? {
      qa_layer_b_verdict: layerBVerdict,
      qa_layer_b_issues: layerBIssues,
      qa_layer_b_confidence: layerBResult.confidence ?? null,
      qa_layer_b_severity_score: layerBResult.severity_score ?? null,
      qa_layer_b_prompt_version: layerBResult.prompt_version ?? null,
      qa_layer_b_model: layerBResult.model ?? null,
      qa_layer_b_ran_at: layerBResult.ran_at ?? new Date().toISOString(),
      qa_layer_b_error: layerBResult.error ?? null,
      qa_layer_b_latency_ms: layerBResult.latency_ms ?? null,
      layer_b_retry_count: layerBRetryCount,
    } : {}),
  }, supabase);

  // Track cost
  await incrementBudgetAtomic(supabase, totalCost);

  console.log(`   ✅ Enriched! (${totalTokens} tokens, $${totalCost.toFixed(4)}, pass2: ${pass2Model})`);
  console.log(`   Level: ${constrainedEditorial.ruling_impact_level} (${constrainedEditorial.ruling_label})`);
  console.log(`   Public: ${isPublic} | Review: ${needsReview} | Clamp: ${clampedFacts.clamp_reason || 'none'}`);
  console.log(`   Who wins: ${(constrainedEditorial.who_wins || '').substring(0, 50)}...`);
  if (scotusblogResult?.found) {
    console.log(`   SCOTUSblog: grounded (${scotusblogResult.searchStrategy})`);
  }
  // ADO-446: Log reconciliation summary
  const rcSummary = reconciliationCorrections
    .filter(c => c.outcome !== 'no_change' && c.outcome !== 'no_scotusblog')
    .map(c => `${c.field}:${c.outcome}`)
    .join(', ');
  if (rcSummary) {
    console.log(`   Reconciliation: ${rcSummary}`);
  }

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
    pass2Model,  // ADO-429: Track which model was used for Pass 2
    scotusblogGrounded: scotusblogResult?.found || false,  // ADO-429
    reconciliationCorrections,  // ADO-446: Cross-check outcomes
    // For anti-repetition: track summary_spicy for signature detection
    summaryOpening: (constrainedEditorial.summary_spicy || '').substring(0, 150)
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = parseArgs();

  console.log(`\n🔍 SCOTUS Enrichment Script (v9-ado438: Simplified Pipeline)`);
  console.log(`================================================`);
  console.log(`Batch size: ${args.limit}`);
  console.log(`Dry run: ${args.dryRun}`);
  console.log(`Allow PROD: ${args.allowProd}`);
  console.log(`Skip consensus: ${args.skipConsensus || SCOTUS_SKIP_CONSENSUS}`);
  console.log(`Force gold: ${args.forceGold}`);
  console.log(`SCOTUSblog grounding: ${args.noScotusblog ? 'DISABLED' : 'ENABLED'}`);
  console.log(`Pass 2 model: ${PASS2_MODEL}`);
  console.log(`Prompt version: ${PROMPT_VERSION}`);
  console.log(`Layer B mode: ${SCOTUS_SKIP_LAYER_B ? 'BYPASSED' : LAYER_B_MODE}`);
  console.log(`--- ADO-438 Bypass Flags ---`);
  console.log(`  Consensus:      ${SCOTUS_SKIP_CONSENSUS ? 'SKIP (single Pass 1)' : 'enabled'}`);
  console.log(`  Drift:          ${SCOTUS_SKIP_DRIFT ? 'SKIP' : 'enabled'}`);
  console.log(`  QA Validators:  ${SCOTUS_SKIP_QA_VALIDATORS ? 'SKIP' : 'enabled'}`);
  console.log(`  Layer B:        ${SCOTUS_SKIP_LAYER_B ? 'SKIP' : 'enabled'}`);
  console.log(`Pass 2 temperature: ${PASS2_TEMPERATURE}`);
  console.log(``);

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
    // ADO-323: Use targeted IDs if provided, otherwise use limit-based selection
    cases = args.caseIds?.length
      ? await getCasesToEnrichByIds(args.caseIds, supabase)
      : await getCasesToEnrich(args.limit, supabase);
  } catch (error) {
    console.error(`\n❌ Query failed: ${error.message}`);
    process.exit(1);
  }

  if (!cases || cases.length === 0) {
    console.log('\n✅ No cases to enrich.');
    console.log('   (Cases need enrichment_status=pending/failed AND syllabus/excerpt)\n');
    return;
  }

  // ADO-394: Gold set protection — skip is_gold_set cases unless --force-gold
  if (!args.forceGold) {
    const beforeCount = cases.length;
    cases = cases.filter(c => !c.is_gold_set);
    const skippedGold = beforeCount - cases.length;
    if (skippedGold > 0) {
      console.log(`\n🛡️ Gold set protection: skipped ${skippedGold} gold case(s). Use --force-gold to override.`);
    }
    if (cases.length === 0) {
      console.log('\n✅ No non-gold cases to enrich.');
      return;
    }
  } else {
    const goldCount = cases.filter(c => c.is_gold_set).length;
    if (goldCount > 0) {
      console.log(`\n⚠️ --force-gold: including ${goldCount} gold set case(s)`);
    }
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
    review: 0,
    scotusblogGrounded: 0,  // ADO-429
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
        if (result.scotusblogGrounded) results.scotusblogGrounded++;
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
  console.log(`   SCOTUSblog grounded: ${results.scotusblogGrounded}/${successCount}`);
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
