/**
 * SCOTUS Eval — D1-D11 Dimension Implementations
 *
 * Evaluates SCOTUS enrichment quality across 11 dimensions.
 * LLM judge calls (D1, D3, D6) are gold-set-only to control cost.
 * All other checks are deterministic.
 *
 * Session 1: Measurement only. No enforcement, no prompt changes.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { STATUS, dimResult, buildEvalResult, SCOTUS_BLOCK_CONFIG } from './eval-types.js';
import {
  checkOpenerUniqueness,
  checkSectionUniqueness,
  checkEnumField,
  checkAnchorFormat,
  checkQuoteGrounding,
  checkStringNull,
  checkDissentIntegrity,
} from './shared-eval-utils.js';

// Reuse existing SCOTUS utilities
import {
  RULING_IMPACT_LEVELS,
  ISSUE_AREA_LABELS,
  isGenericParty,
  hasConcreteFactMarker,
  checkNoAbstractOpener,
} from '../enrichment/scotus-gpt-prompt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VALID_ISSUE_AREAS = Object.keys(ISSUE_AREA_LABELS);

// ============================================================================
// LLM JUDGE CONFIG
// ============================================================================

const JUDGE_MODEL = 'gpt-4o-mini';
const JUDGE_TEMPERATURE = 0;
const JUDGE_TOP_P = 1;
const JUDGE_MAX_TOKENS = 500;

// ============================================================================
// GOLD SET LOADER
// ============================================================================

export function loadGoldSet() {
  const goldPath = join(__dirname, '..', 'scotus', 'gold-set.json');
  const raw = readFileSync(goldPath, 'utf-8');
  return JSON.parse(raw).cases;
}

// ============================================================================
// DB FETCHERS
// ============================================================================

const CASE_FIELDS = [
  'id', 'case_name', 'ruling_impact_level', 'ruling_label', 'issue_area',
  'who_wins', 'who_loses', 'summary_spicy', 'why_it_matters',
  'evidence_anchors', 'dissent_highlights', 'dissent_exists', 'dissent_authors',
  'vote_split', 'majority_author', 'prompt_version', 'enriched_at',
  'holding', 'syllabus',
].join(',');

/**
 * Fetch all public SCOTUS cases (for aggregate eval).
 * NOTE: Intentionally no .limit() — eval needs all public cases for aggregate stats.
 * At ~20-51 cases with ~3KB/row this is ~60-150KB egress, well within budget.
 * If the public case count grows past ~200, add pagination or field trimming.
 */
export async function fetchPublicCases(supabase) {
  const { data, error } = await supabase
    .from('scotus_cases')
    .select(CASE_FIELDS)
    .eq('is_public', true)
    .order('id', { ascending: true });

  if (error) throw new Error(`Failed to fetch public cases: ${error.message}`);
  return data;
}

/**
 * Fetch opinion text for specific case IDs (gold set only — egress-conscious)
 */
export async function fetchOpinionTexts(supabase, caseIds) {
  if (!caseIds || caseIds.length === 0) return {};

  const { data, error } = await supabase
    .from('scotus_opinions')
    .select('case_id,opinion_full_text')
    .in('case_id', caseIds);

  if (error) throw new Error(`Failed to fetch opinions: ${error.message}`);

  const map = {};
  for (const row of (data || [])) {
    map[row.case_id] = row.opinion_full_text;
  }
  return map;
}

// ============================================================================
// ADO-394: GOLD CASE SNAPSHOT FOR DEBUGGING
// ============================================================================

/**
 * Fetch raw enrichment data for all gold cases (saved alongside eval results).
 * This preserves the exact data that was evaluated, for later debugging.
 */
export async function fetchGoldCaseSnapshots(supabase) {
  const goldCases = loadGoldSet();
  const goldIds = goldCases.map(g => g.case_id);

  const SNAPSHOT_FIELDS = [
    'id', 'case_name', 'decided_at', 'majority_author', 'vote_split',
    'dissent_exists', 'dissent_authors', 'enrichment_status',
    'ruling_impact_level', 'ruling_label', 'issue_area',
    'who_wins', 'who_loses', 'summary_spicy', 'why_it_matters',
    'dissent_highlights', 'evidence_anchors', 'evidence_quotes',
    'prompt_version', 'disposition', 'holding', 'prevailing_party',
    'practical_effect', 'case_type', 'merits_reached',
    'is_public', 'needs_manual_review', 'clamp_reason', 'is_gold_set',
  ].join(',');

  const { data, error } = await supabase
    .from('scotus_cases')
    .select(SNAPSHOT_FIELDS)
    .in('id', goldIds)
    .order('id');

  if (error) throw new Error(`Failed to fetch gold snapshots: ${error.message}`);

  return data.map(c => ({
    ...c,
    gold_expectations: goldCases.find(g => g.case_id === c.id),
    snapshot_timestamp: new Date().toISOString(),
  }));
}

// ============================================================================
// D1: SEVERITY CONGRUENCE (LLM Judge)
// ============================================================================

function buildD1Prompt(caseData) {
  const levelDefs = Object.entries(RULING_IMPACT_LEVELS)
    .map(([n, l]) => `  ${n} = ${l.label}: ${l.editorial_logic}`)
    .join('\n');

  return {
    system: `You are a judicial severity evaluator. Given SCOTUS case facts, determine the appropriate ruling impact level (0-5).

Levels:
${levelDefs}

Key principles:
- Unanimous decisions rarely warrant level 4-5 unless they strip rights
- Technical/procedural rulings usually fall in 2-3
- People-win cases (individual defeats government/corporation) are 0-1
- Only use level 5 for genuine precedent destruction or corruption

Return JSON only.`,

    user: `Case: ${caseData.case_name}
Vote: ${caseData.vote_split || 'unknown'}
Author: ${caseData.majority_author || 'per curiam'}
Holding: ${(caseData.holding || '').slice(0, 500)}
Who wins: ${(caseData.who_wins || '').slice(0, 200)}
Who loses: ${(caseData.who_loses || '').slice(0, 200)}
Syllabus excerpt: ${(caseData.syllabus || '').slice(0, 800)}
Assigned level: ${caseData.ruling_impact_level}

Return JSON: { "suggested_level": <0-5>, "confidence": <0.0-1.0>, "reasoning": "<1-2 sentences>" }`,
  };
}

async function evalD1(caseData, goldEntry, openai) {
  if (!openai) return dimResult(STATUS.SKIP, 'No OpenAI client (LLM judge unavailable)');

  const prompt = buildD1Prompt(caseData);
  try {
    const response = await openai.chat.completions.create({
      model: JUDGE_MODEL,
      temperature: JUDGE_TEMPERATURE,
      top_p: JUDGE_TOP_P,
      max_tokens: JUDGE_MAX_TOKENS,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    });

    const result = JSON.parse(response.choices[0].message.content);
    const suggested = result.suggested_level;
    const current = caseData.ruling_impact_level;
    const diff = Math.abs(suggested - current);

    // Check against gold set expected range
    let withinGoldRange = true;
    if (goldEntry) {
      const [lo, hi] = goldEntry.expected_level_range;
      withinGoldRange = current >= lo && current <= hi;
    }

    if (diff === 0 && withinGoldRange) {
      return dimResult(STATUS.PASS, `Level ${current} matches judge (${result.reasoning})`, 1);
    }
    if (diff <= 1) {
      return dimResult(
        STATUS.WARN,
        `Current=${current}, judge=${suggested}, gold=${goldEntry ? goldEntry.expected_level_range : 'n/a'}. ${result.reasoning}`,
        Math.max(0, 1 - diff * 0.2)
      );
    }
    return dimResult(
      STATUS.FAIL,
      `Current=${current}, judge=${suggested}, gold=${goldEntry ? goldEntry.expected_level_range : 'n/a'} (diff=${diff}). ${result.reasoning}`,
      Math.max(0, 1 - diff * 0.2)
    );
  } catch (err) {
    return dimResult(STATUS.SKIP, `LLM judge error: ${err.message}`);
  }
}

// ============================================================================
// D2: SEVERITY DISTRIBUTION (Aggregate — deterministic)
// ============================================================================

export function evalD2(cases) {
  const dist = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const c of cases) {
    const lvl = c.ruling_impact_level;
    if (lvl >= 0 && lvl <= 5) dist[lvl]++;
  }

  const total = cases.length;
  const level4plus = dist[4] + dist[5];
  const level4pct = Math.round((level4plus / total) * 100);
  const emptyLevels = Object.entries(dist).filter(([, v]) => v === 0).map(([k]) => k);

  let status = STATUS.PASS;
  const notes = [];

  if (level4pct > 60) {
    status = STATUS.FAIL;
    notes.push(`${level4pct}% at level 4-5 (expected <40%)`);
  } else if (level4pct > 40) {
    status = STATUS.WARN;
    notes.push(`${level4pct}% at level 4-5 (expected <40%)`);
  }

  if (emptyLevels.length > 2) {
    status = status === STATUS.PASS ? STATUS.WARN : status;
    notes.push(`Empty levels: ${emptyLevels.join(', ')}`);
  }

  return {
    ...dimResult(status, notes.join('; ') || 'Distribution reasonable', 1 - level4pct / 100),
    distribution: dist,
    level4plus_pct: level4pct,
  };
}

// ============================================================================
// D3: TONE-LEVEL ALIGNMENT (LLM Judge)
// ============================================================================

function buildD3Prompt(caseData) {
  const levelInfo = RULING_IMPACT_LEVELS[caseData.ruling_impact_level] || {};

  return {
    system: `You are evaluating whether editorial tone matches the assigned severity level for a SCOTUS case tracker.

Expected tone for level ${caseData.ruling_impact_level} (${levelInfo.label || 'unknown'}):
${levelInfo.tone || 'No tone defined'}

Profanity allowed: ${levelInfo.profanity ? 'YES' : 'NO'}

Return JSON only.`,

    user: `Text to evaluate:
${(caseData.summary_spicy || '').slice(0, 800)}

Does this text match the expected tone for level ${caseData.ruling_impact_level}?

Return JSON: { "tone_matches": true|false, "detected_tone": "<brief description>", "reasoning": "<1-2 sentences>" }`,
  };
}

async function evalD3(caseData, openai) {
  if (!openai) return dimResult(STATUS.SKIP, 'No OpenAI client');

  const prompt = buildD3Prompt(caseData);
  try {
    const response = await openai.chat.completions.create({
      model: JUDGE_MODEL,
      temperature: JUDGE_TEMPERATURE,
      top_p: JUDGE_TOP_P,
      max_tokens: JUDGE_MAX_TOKENS,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    });

    const result = JSON.parse(response.choices[0].message.content);

    if (result.tone_matches) {
      return dimResult(STATUS.PASS, `Tone matches level ${caseData.ruling_impact_level}: ${result.detected_tone}`, 1);
    }
    return dimResult(
      STATUS.WARN,
      `Tone mismatch for level ${caseData.ruling_impact_level}: detected "${result.detected_tone}". ${result.reasoning}`,
      0.5
    );
  } catch (err) {
    return dimResult(STATUS.SKIP, `LLM judge error: ${err.message}`);
  }
}

// ============================================================================
// D6: FACTUAL ACCURACY (LLM Judge)
// ============================================================================

/**
 * Window source text for D6 judge: first 3000 chars + last 3000 chars.
 * Mirrors the enrichment pipeline's approach — dissent text is at the end of
 * opinions, so we need the tail to catch phantom dissent references.
 */
function windowSourceText(text, maxTotal = 6000) {
  if (!text) return '';
  if (text.length <= maxTotal) return text;
  const half = Math.floor(maxTotal / 2);
  return text.slice(0, half) + '\n\n[... middle omitted ...]\n\n' + text.slice(-half);
}

function buildD6Prompt(caseData, sourceText) {
  return {
    system: `You are a factual accuracy checker for SCOTUS case summaries. Compare editorial claims against authoritative source text. Look for:
1. Claims that CONTRADICT the source text (wrong outcome, wrong party, wrong holding)
2. Fabricated dissent or concurrence references (mentioning justices who didn't actually dissent)
3. Invented statistics or facts not in the source

Be strict on factual contradictions. Be lenient on editorial tone/framing — spin is OK, wrong facts are not.
If the editorial says "reversed" or "affirmed" check this matches the actual outcome.
If dissent_highlights names a justice, check if they actually dissented in the source text.

Return JSON only.`,

    user: `SOURCE TEXT (authoritative — includes beginning and end of opinion):
${windowSourceText(sourceText)}

EDITORIAL CLAIMS:
- Who wins: ${caseData.who_wins || 'null'}
- Who loses: ${caseData.who_loses || 'null'}
- Summary: ${(caseData.summary_spicy || '').slice(0, 600)}
- Why it matters: ${(caseData.why_it_matters || '').slice(0, 600)}
- Dissent highlights: ${(caseData.dissent_highlights || 'null').slice(0, 300)}

Return JSON: { "has_contradictions": true|false, "contradiction_count": <n>, "contradictions": ["<description>", ...], "confidence": <0.0-1.0> }`,
  };
}

async function evalD6(caseData, sourceText, openai) {
  if (!openai) return dimResult(STATUS.SKIP, 'No OpenAI client');
  if (!sourceText || sourceText.length < 200) {
    return dimResult(STATUS.SKIP, 'Source text too short for factual accuracy check');
  }

  const prompt = buildD6Prompt(caseData, sourceText);
  try {
    const response = await openai.chat.completions.create({
      model: JUDGE_MODEL,
      temperature: JUDGE_TEMPERATURE,
      top_p: JUDGE_TOP_P,
      max_tokens: JUDGE_MAX_TOKENS,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    });

    const result = JSON.parse(response.choices[0].message.content);

    if (!result.has_contradictions || result.contradiction_count === 0) {
      return dimResult(STATUS.PASS, 'No factual contradictions found', 1);
    }
    return dimResult(
      STATUS.FAIL,
      `${result.contradiction_count} contradiction(s): ${result.contradictions.join('; ')}`,
      1 - (result.contradiction_count * 0.25)
    );
  } catch (err) {
    return dimResult(STATUS.SKIP, `LLM judge error: ${err.message}`);
  }
}

// ============================================================================
// D7: ISSUE AREA (deterministic)
// ============================================================================

function evalD7(caseData) {
  return checkEnumField(caseData.issue_area, VALID_ISSUE_AREAS, 'issue_area');
}

// ============================================================================
// D8: EVIDENCE ANCHORS (deterministic format + optional grounding)
// ============================================================================

function evalD8(caseData, sourceText) {
  const formatCheck = checkAnchorFormat(caseData.evidence_anchors);

  // Quote grounding check only runs when source text is available (gold-set cases only).
  // For non-gold cases, sourceText is null (opinion texts not fetched to save egress).
  // Format check alone catches the most common issue: all-generic section labels.
  if (sourceText && sourceText.length > 200) {
    const groundingCheck = checkQuoteGrounding(caseData.evidence_anchors, sourceText);
    // Combine: take the worse status
    if (groundingCheck.status === STATUS.FAIL && formatCheck.status !== STATUS.FAIL) {
      return {
        ...groundingCheck,
        format_check: formatCheck,
      };
    }
  }

  return formatCheck;
}

// ============================================================================
// D9: DISSENT INTEGRITY (deterministic)
// ============================================================================

function evalD9(caseData) {
  return checkDissentIntegrity(caseData);
}

// ============================================================================
// D10: WHO WINS/LOSES SPECIFICITY (deterministic — reuses existing isGenericParty)
// ============================================================================

function evalD10(caseData) {
  const issues = [];

  if (isGenericParty(caseData.who_wins)) {
    issues.push(`who_wins is generic: "${(caseData.who_wins || '').slice(0, 50)}"`);
  }
  if (isGenericParty(caseData.who_loses)) {
    issues.push(`who_loses is generic: "${(caseData.who_loses || '').slice(0, 50)}"`);
  }

  if (issues.length > 0) {
    return dimResult(STATUS.FAIL, issues.join('; '));
  }
  return dimResult(STATUS.PASS, 'who_wins and who_loses are specific');
}

// ============================================================================
// D11: WHY-IT-MATTERS GROUNDING (deterministic — reuses existing validators)
// ============================================================================

function evalD11(caseData) {
  const text = caseData.why_it_matters;
  const caseName = caseData.case_name || '';

  if (!text || typeof text !== 'string') {
    return dimResult(STATUS.FAIL, 'why_it_matters is empty');
  }

  const factCheck = hasConcreteFactMarker(text, caseName);
  const openerCheck = checkNoAbstractOpener(text, caseName);

  const issues = [];
  if (!factCheck.passed) issues.push(factCheck.reason);
  if (!openerCheck.passed) issues.push(openerCheck.reason);

  if (issues.length > 0) {
    return dimResult(STATUS.WARN, issues.join('; '));
  }
  return dimResult(STATUS.PASS, 'why_it_matters has concrete facts and specific opener');
}

// ============================================================================
// PER-CASE EVALUATION
// ============================================================================

/**
 * Run all applicable dimensions on a single case
 * @param {Object} caseData - DB row
 * @param {Object|null} goldEntry - Gold set entry (null for non-gold)
 * @param {string|null} sourceText - Opinion text (null for non-gold/aggregate)
 * @param {Object|null} openai - OpenAI client (null = skip LLM judges)
 * @param {string} runId
 * @returns {Object} EvalResult
 */
async function evalCase(caseData, goldEntry, sourceText, openai, runId) {
  const isGold = !!goldEntry;

  // LLM judge dimensions (gold-set only)
  const d1 = isGold ? await evalD1(caseData, goldEntry, openai) : dimResult(STATUS.SKIP, 'Non-gold: skipped');
  const d3 = isGold ? await evalD3(caseData, openai) : dimResult(STATUS.SKIP, 'Non-gold: skipped');
  const d6 = isGold ? await evalD6(caseData, sourceText || caseData.syllabus, openai) : dimResult(STATUS.SKIP, 'Non-gold: skipped');

  // Deterministic dimensions (all cases)
  const d5 = checkSectionUniqueness({
    summary_spicy: caseData.summary_spicy,
    why_it_matters: caseData.why_it_matters,
    dissent_highlights: caseData.dissent_highlights,
  });
  const d7 = evalD7(caseData);
  const d8 = evalD8(caseData, sourceText);
  const d9 = evalD9(caseData);
  const d10 = evalD10(caseData);
  const d11 = evalD11(caseData);

  return buildEvalResult({
    content_type: 'scotus',
    content_id: caseData.id,
    prompt_version: caseData.prompt_version,
    model: JUDGE_MODEL,
    run_id: runId,
    dimensions: {
      D1_severity_congruence: d1,
      D3_tone_alignment: d3,
      D5_section_uniqueness: d5,
      D6_factual_accuracy: d6,
      D7_issue_area: d7,
      D8_evidence_anchors: d8,
      D9_dissent_integrity: d9,
      D10_party_specificity: d10,
      D11_why_grounding: d11,
    },
    blockConfig: SCOTUS_BLOCK_CONFIG,
  });
}

// ============================================================================
// MAIN EVAL RUNNER
// ============================================================================

/**
 * Run SCOTUS eval
 * @param {Object} config
 * @param {Object} config.supabase - Supabase client
 * @param {Object|null} config.openai - OpenAI client (null = skip LLM judges)
 * @param {boolean} config.goldOnly - Only evaluate gold set cases
 * @param {number[]} config.caseIds - Specific case IDs (overrides goldOnly)
 * @param {string} config.runId - Unique run identifier
 * @returns {{ goldResults: Object[], aggregateResults: Object[], aggregateStats: Object }}
 */
export async function runScotusEval(config) {
  const { supabase, openai, goldOnly, caseIds, runId } = config;

  // Load gold set
  const goldSet = loadGoldSet();
  const goldIds = goldSet.map(g => g.case_id);
  const goldMap = Object.fromEntries(goldSet.map(g => [g.case_id, g]));

  console.log(`\n=== SCOTUS Eval Run: ${runId} ===`);
  console.log(`Gold set: ${goldIds.length} cases`);
  console.log(`Mode: ${goldOnly ? 'gold-only' : caseIds ? `specific IDs: ${caseIds}` : 'full baseline'}`);

  // Fetch all public cases
  const allCases = await fetchPublicCases(supabase);
  console.log(`Fetched ${allCases.length} public cases from DB`);

  // Determine which cases to evaluate
  let evalCases;
  if (caseIds && caseIds.length > 0) {
    evalCases = allCases.filter(c => caseIds.includes(c.id));
  } else if (goldOnly) {
    evalCases = allCases.filter(c => goldIds.includes(c.id));
  } else {
    evalCases = allCases;
  }

  // Fetch opinion texts for gold set cases (egress-conscious)
  const goldCaseIds = evalCases.filter(c => goldIds.includes(c.id)).map(c => c.id);
  const opinionTexts = goldCaseIds.length > 0
    ? await fetchOpinionTexts(supabase, goldCaseIds)
    : {};
  console.log(`Fetched opinion texts for ${Object.keys(opinionTexts).length} gold cases`);

  // Evaluate each case
  const goldResults = [];
  const aggregateResults = [];

  for (const caseData of evalCases) {
    const isGold = goldIds.includes(caseData.id);
    const goldEntry = goldMap[caseData.id] || null;
    const sourceText = opinionTexts[caseData.id] || null;

    const result = await evalCase(caseData, goldEntry, sourceText, openai, runId);

    if (isGold) {
      goldResults.push(result);
      console.log(`  [GOLD] ${caseData.id} ${caseData.case_name.slice(0, 40)}... blocking=${result.blocking}`);
    } else {
      aggregateResults.push(result);
    }
  }

  // D2: Severity distribution (aggregate over ALL public cases)
  const d2 = evalD2(allCases);
  console.log(`\nD2 severity distribution:`, d2.distribution);

  // D4: Opener uniqueness (aggregate over ALL public cases)
  const d4 = checkOpenerUniqueness(
    allCases.map(c => ({ id: c.id, text: c.summary_spicy }))
  );
  console.log(`D4 opener uniqueness: ${d4.status} (${d4.duplicates.length} similar pairs)`);

  // Compute aggregate stats
  const allResults = [...goldResults, ...aggregateResults];
  const aggregateStats = computeAggregateStats(allResults, allCases, d2, d4);

  return { goldResults, aggregateResults, aggregateStats, d2, d4 };
}

// ============================================================================
// AGGREGATE STATS
// ============================================================================

function computeAggregateStats(allResults, allCases, d2, d4) {
  const total = allResults.length;
  if (total === 0) return {};

  // Count dimension failures across all evaluated cases
  const dimCounts = {};
  let blockingCount = 0;
  let warnCount = 0;

  for (const result of allResults) {
    if (result.blocking) blockingCount++;
    if (result.warn_reasons.length > 0) warnCount++;

    for (const [dim, val] of Object.entries(result.dimensions)) {
      if (!dimCounts[dim]) dimCounts[dim] = { pass: 0, warn: 0, fail: 0, skip: 0 };
      dimCounts[dim][val.status]++;
    }
  }

  // Specific rates
  const issueAreaNulls = allCases.filter(c => !c.issue_area).length;
  const stringNulls = allCases.filter(c => {
    const dh = c.dissent_highlights;
    return dh && typeof dh === 'string' && /^(null|none|n\/a|undefined)$/i.test(dh.trim());
  }).length;
  const phantomDissents = allCases.filter(c => {
    return !c.dissent_exists
      && (!c.dissent_authors || c.dissent_authors.length === 0)
      && c.dissent_highlights
      && typeof c.dissent_highlights === 'string'
      && c.dissent_highlights.trim().length > 30;
  }).length;

  // Evidence anchor quality
  let genericAnchorCases = 0;
  for (const c of allCases) {
    if (!c.evidence_anchors || !Array.isArray(c.evidence_anchors)) {
      genericAnchorCases++;
      continue;
    }
    const allGeneric = c.evidence_anchors.every(a =>
      /^(syllabus|majority\s*§?\s*[IVX\d–-]+|dissent[,\s]|concurrence[,\s]|majority\s+opinion|majority|dissent|concurrence)/i.test(a.trim())
    );
    if (allGeneric) genericAnchorCases++;
  }

  // Generic party check
  const genericPartyCases = allCases.filter(c =>
    isGenericParty(c.who_wins) || isGenericParty(c.who_loses)
  ).length;

  // Contradiction rate (gold-set only — requires LLM judge)
  const goldWithD6 = allResults.filter(r =>
    r.dimensions.D6_factual_accuracy && r.dimensions.D6_factual_accuracy.status !== STATUS.SKIP
  );
  const contradictions = goldWithD6.filter(r => r.dimensions.D6_factual_accuracy.status === STATUS.FAIL);

  return {
    total_evaluated: total,
    total_public: allCases.length,
    blocking_count: blockingCount,
    blocking_rate_pct: Math.round((blockingCount / total) * 100),
    warn_count: warnCount,

    severity_distribution: d2.distribution,
    severity_level4plus_pct: d2.level4plus_pct,

    issue_area_null_count: issueAreaNulls,
    issue_area_null_rate_pct: Math.round((issueAreaNulls / allCases.length) * 100),

    evidence_anchor_all_generic_count: genericAnchorCases,
    evidence_anchor_all_generic_rate_pct: Math.round((genericAnchorCases / allCases.length) * 100),

    string_null_count: stringNulls,
    string_null_rate_pct: Math.round((stringNulls / allCases.length) * 100),

    phantom_dissent_count: phantomDissents,
    phantom_dissent_rate_pct: Math.round((phantomDissents / allCases.length) * 100),

    generic_party_count: genericPartyCases,
    generic_party_rate_pct: Math.round((genericPartyCases / allCases.length) * 100),

    opener_similar_pairs: d4.duplicates ? d4.duplicates.length : 0,

    // Gold-set-specific: contradiction rate (the key KPI)
    contradiction_rate: {
      evaluated: goldWithD6.length,
      contradictions: contradictions.length,
      rate_pct: goldWithD6.length > 0
        ? Math.round((contradictions.length / goldWithD6.length) * 100)
        : null,
    },

    dimension_summary: dimCounts,
  };
}
