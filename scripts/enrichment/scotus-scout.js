#!/usr/bin/env node
/**
 * SCOTUS Scout — Perplexity-powered fact extraction for SCOTUS cases
 *
 * Replaces GPT Pass 1 with a validated, source-tiered extraction subsystem.
 * Scout owns factual fields only; Pass 2 Writer remains the editorial layer.
 *
 * Usage:
 *   node scripts/enrichment/scotus-scout.js --dry-run --ids=51,64,137
 *   node scripts/enrichment/scotus-scout.js --dry-run --gold-set
 *   node scripts/enrichment/scotus-scout.js --dry-run --limit=20
 *   node scripts/enrichment/scotus-scout.js --dry-run --all
 *   node scripts/enrichment/scotus-scout.js --ids=51 --write-fields=disposition,vote_split
 *   node scripts/enrichment/scotus-scout.js --dry-run --output-json=results.json
 *   node scripts/enrichment/scotus-scout.js --dry-run --fail-on-uncertain
 *   node scripts/enrichment/scotus-scout.js --dry-run --show-sources
 *
 * Environment:
 *   SUPABASE_URL / SUPABASE_TEST_URL
 *   SUPABASE_SERVICE_ROLE_KEY / SUPABASE_TEST_SERVICE_KEY
 *   PERPLEXITY_API_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { PerplexityClient } from './perplexity-client.js';
import { buildScoutPrompt, SCOUT_PROMPT_VERSION, SCOUT_SYSTEM_PROMPT } from '../scotus/scout-prompt.js';
import { parseScoutResponse } from '../scotus/scout-parser.js';
import { validateScoutResult } from '../scotus/scout-validator.js';
import { extractDispositionFromSyllabus } from '../scotus/syllabus-extractor.js';
import { fetchOyezCase } from '../scotus/oyez-client.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================
// Constants
// ============================================================

const DELAY_BETWEEN_CALLS_MS = 2000;
const RUNTIME_LIMIT_MS = 8 * 60 * 1000; // 8 minutes

// Scout-owned DB fields (only these get written in live mode)
const SCOUT_DB_FIELDS = [
  'disposition',        // ← formal_disposition
  'vote_split',
  'majority_author',
  'dissent_authors',
  'prevailing_party',   // ← substantive_winner
  'practical_effect',
  'holding',
  'issue_area',
  'case_type',          // derived from opinion_type/disposition
  'merits_reached',     // derived
];

// Metadata fields written alongside facts
const SCOUT_META_FIELDS = [
  'fact_extraction_confidence',
  'low_confidence_reason',
  'prompt_version',
];

// ============================================================
// GPT cross-check for dissent authors from opinion text
// ============================================================

async function crossCheckDissentersFromOpinion(supabase, caseId, openaiKey) {
  if (!openaiKey) return null;

  const { data } = await supabase
    .from('scotus_opinions')
    .select('opinion_full_text')
    .eq('case_id', caseId)
    .maybeSingle();

  if (!data?.opinion_full_text) return null;

  // Extract opinion header: find the justice lineup block (usually near top of opinion)
  // Grab lines around any mention of deliver/dissent/concur/joined/JUSTICE
  const lines = data.opinion_full_text.split('\n').slice(0, 300);
  const headerLines = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.match(/deliver|dissent|concurr|joined|filed an opinion|JUSTICE\s+\w+/i) && l.trim().length > 5) {
      // Include surrounding context (1 line before, 2 after) for multi-line headers
      for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 2); j++) {
        const ctx = lines[j].trim();
        if (ctx.length > 3 && !headerLines.includes(ctx)) {
          headerLines.push(ctx);
        }
      }
    }
  }
  if (headerLines.length === 0) return null;

  // Cap at ~2000 chars to stay within GPT token budget
  const header = headerLines.join('\n').slice(0, 2000);

  const openai = new OpenAI({ apiKey: openaiKey });
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 300,
    messages: [
      {
        role: 'system',
        content: 'Extract factual details from a SCOTUS opinion header. Return JSON only, no markdown, no code blocks.'
      },
      {
        role: 'user',
        content: `From this SCOTUS opinion header, extract:
1. ALL justices who dissented or joined a dissenting opinion (NOT concurrences)
2. The vote split (count majority + concurrence-in-judgment vs dissenters)

CRITICAL: Include ALL justices who dissented, even partial dissenters:
- "JUSTICE X joined all but Part IV" of a dissent → X IS a dissenter
- "JUSTICE X concurred in part and dissented in part" → X IS a dissenter
- "JUSTICE X filed a concurring opinion" (only concurrence, no dissent) → X is NOT a dissenter
- "JUSTICE X joined the opinion except as to Part III" of a MAJORITY → X is NOT a dissenter
Context matters: partial joiner of a DISSENT = dissenter. Partial joiner of the MAJORITY = not a dissenter.

Return JSON: {"dissent_authors": ["Last1", "Last2"], "vote_split": "N-N"}
If no dissenters, return {"dissent_authors": [], "vote_split": "9-0"}

${header}`
      }
    ]
  });

  const raw = resp.choices[0].message.content.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(raw);

  const result = { dissenters: null, vote_split: null, _headerText: header };

  if (parsed.dissent_authors && Array.isArray(parsed.dissent_authors)) {
    result.dissenters = parsed.dissent_authors.map(n => {
      const name = n.replace(/^JUSTICE\s+/i, '').trim();
      return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
    });
  }
  if (parsed.vote_split && /^\d+-\d+$/.test(parsed.vote_split)) {
    result.vote_split = parsed.vote_split;
  }

  return result;
}

// ============================================================
// Deterministic dissenter regex post-check
// Context-anchored: partial joiners only count within dissent blocks
// ============================================================

function extractDissentersFromHeader(headerText, scotusJustices) {
  if (!headerText) return [];
  const lines = headerText.split('\n');
  const dissenters = new Set();

  // Step 1: Find dissent anchor lines
  const dissentAnchors = [];
  for (let i = 0; i < lines.length; i++) {
    const authorMatch = lines[i].match(/([A-Z]+),\s*(?:C\.\s*)?J\.\s*,?\s*filed\s+a\s+dissenting\s+opinion/i);
    if (authorMatch) {
      dissentAnchors.push(i);
      const name = authorMatch[1].charAt(0) + authorMatch[1].slice(1).toLowerCase();
      if (scotusJustices.has(name)) dissenters.add(name);
    }
  }

  // Step 2: Within each dissent block (anchor + next 3 lines), extract co-dissenters and partial joiners
  for (const anchorIdx of dissentAnchors) {
    const blockEnd = Math.min(lines.length, anchorIdx + 4);
    const blockText = lines.slice(anchorIdx, blockEnd).join(' ');

    // Co-dissenters: "in which KAGAN and JACKSON, JJ., joined"
    const coMatch = blockText.match(/in\s+which\s+([A-Z]+(?:\s+and\s+[A-Z]+)*),\s*JJ?\.\s*,?\s*joined/i);
    if (coMatch) {
      for (const n of coMatch[1].split(/\s+and\s+/i)) {
        const name = n.trim().charAt(0) + n.trim().slice(1).toLowerCase();
        if (scotusJustices.has(name)) dissenters.add(name);
      }
    }

    // Single co-dissenter: "in which KAGAN, J., joined"
    const singleCoMatch = blockText.match(/in\s+which\s+([A-Z]+),\s*(?:C\.\s*)?J\.\s*,?\s*joined/i);
    if (singleCoMatch) {
      const name = singleCoMatch[1].charAt(0) + singleCoMatch[1].slice(1).toLowerCase();
      if (scotusJustices.has(name)) dissenters.add(name);
    }

    // Partial joiners in dissent context: "GORSUCH, J., joined all but Part IV"
    for (let i = anchorIdx; i < blockEnd; i++) {
      const joinMatch = lines[i].match(/([A-Z]+),\s*(?:C\.\s*)?J\.\s*,?\s*joined\s+(?:all|Parts?\s)/i);
      if (joinMatch) {
        const name = joinMatch[1].charAt(0) + joinMatch[1].slice(1).toLowerCase();
        if (scotusJustices.has(name)) dissenters.add(name);
      }
    }
  }

  // Step 3: Anywhere in header — concur-dissent hybrids
  for (const line of lines) {
    const hybridMatch = line.match(/([A-Z]+),\s*(?:C\.\s*)?J\.\s*,?\s*concurring\s+in\s+part\s+and\s+dissenting\s+in\s+part/i);
    if (hybridMatch) {
      const name = hybridMatch[1].charAt(0) + hybridMatch[1].slice(1).toLowerCase();
      if (scotusJustices.has(name)) dissenters.add(name);
    }
  }

  return [...dissenters];
}

// ============================================================
// Gold set loader
// ============================================================

function loadGoldSet() {
  const goldPath = resolve(__dirname, '../../tests/scotus-gold-truth.json');
  const raw = JSON.parse(readFileSync(goldPath, 'utf-8'));
  // Flatten all categories
  return [
    ...(raw.gold_cases || []),
    ...(raw.non_gold_cases || []),
    ...(raw.edge_cases || []),
  ];
}

// ============================================================
// CLI arg parsing
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    dryRun: args.includes('--dry-run'),
    goldSet: args.includes('--gold-set'),
    all: args.includes('--all'),
    showSources: args.includes('--show-sources'),
    failOnUncertain: args.includes('--fail-on-uncertain'),
    skipOyez: args.includes('--skip-oyez'),
    ids: null,
    limit: null,
    writeFields: null,
    outputJson: null,
    model: null,
  };

  for (const arg of args) {
    if (arg.startsWith('--ids=')) {
      opts.ids = arg.split('=')[1].split(',').map(Number).filter(n => !isNaN(n));
    }
    if (arg.startsWith('--limit=')) {
      opts.limit = parseInt(arg.split('=')[1], 10);
    }
    if (arg.startsWith('--write-fields=')) {
      opts.writeFields = arg.split('=')[1].split(',');
    }
    if (arg.startsWith('--output-json=')) {
      opts.outputJson = arg.split('=')[1];
    }
    if (arg.startsWith('--model=')) {
      opts.model = arg.split('=')[1];
    }
  }

  // Validate --ids
  if (opts.ids && opts.ids.length === 0) {
    console.error('Error: --ids provided but no valid numeric IDs found');
    process.exit(1);
  }

  // Validate --write-fields
  if (opts.writeFields) {
    const validWriteFields = [
      'disposition', 'vote_split', 'majority_author', 'dissent_authors',
      'prevailing_party', 'practical_effect', 'holding', 'issue_area',
      'case_type', 'merits_reached',
    ];
    const invalid = opts.writeFields.filter(f => !validWriteFields.includes(f));
    if (invalid.length > 0) {
      console.error(`Error: Unknown --write-fields: ${invalid.join(', ')}`);
      console.error(`  Valid fields: ${validWriteFields.join(', ')}`);
      process.exit(1);
    }
  }

  return opts;
}

// ============================================================
// DB helpers
// ============================================================

async function fetchCases(supabase, opts) {
  const select = 'id,case_name,case_name_short,case_name_full,docket_number,term,decided_at,disposition,vote_split,majority_author,dissent_authors,prevailing_party,holding,issue_area,case_type,enrichment_status';

  let query = supabase.from('scotus_cases').select(select);

  if (opts.ids) {
    query = query.in('id', opts.ids);
  } else if (opts.all) {
    // No filter
  } else if (opts.goldSet) {
    const goldIds = getGoldSet().map(c => c.id);
    query = query.in('id', goldIds);
  }

  query = query.order('id', { ascending: true });

  if (opts.limit) {
    query = query.limit(opts.limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch cases: ${error.message}`);
  return data || [];
}

// ============================================================
// Gold set comparison
// ============================================================

let _goldSetCache = null;
function getGoldSet() {
  if (!_goldSetCache) _goldSetCache = loadGoldSet();
  return _goldSetCache;
}

function compareToGoldSet(scoutResult, caseId) {
  const goldCases = getGoldSet();
  const gold = goldCases.find(g => g.id === caseId);
  if (!gold) return null;

  const diffs = [];

  // Disposition — map Scout formal_disposition to gold's disposition field
  if (gold.disposition && scoutResult.formal_disposition) {
    // Gold uses simple names; Scout uses underscored names
    const scoutDisp = scoutResult.formal_disposition.replace(/_/g, ' ');
    const goldDisp = gold.disposition;
    // Special case: gold may say "vacated" where scout says "vacated_and_remanded"
    const match = scoutDisp === goldDisp ||
      scoutResult.formal_disposition === goldDisp ||
      (goldDisp === 'vacated' && scoutResult.formal_disposition.startsWith('vacated'));
    if (!match) {
      diffs.push({ field: 'disposition', gold: goldDisp, scout: scoutResult.formal_disposition });
    }
  }

  // Vote split
  if (gold.vote_split && scoutResult.vote_split && gold.vote_split !== scoutResult.vote_split) {
    diffs.push({ field: 'vote_split', gold: gold.vote_split, scout: scoutResult.vote_split });
  }

  // Majority author
  if (gold.majority_author_last !== undefined) {
    if (gold.majority_author_last !== scoutResult.majority_author) {
      diffs.push({ field: 'majority_author', gold: gold.majority_author_last, scout: scoutResult.majority_author });
    }
  }

  // Dissent authors
  if (gold.dissent_authors_last) {
    const goldSet = new Set(gold.dissent_authors_last);
    const scoutSet = new Set(scoutResult.dissent_authors || []);
    const missing = [...goldSet].filter(a => !scoutSet.has(a));
    const extra = [...scoutSet].filter(a => !goldSet.has(a));
    if (missing.length > 0 || extra.length > 0) {
      diffs.push({
        field: 'dissent_authors',
        gold: gold.dissent_authors_last,
        scout: scoutResult.dissent_authors,
        missing,
        extra,
      });
    }
  }

  return { caseId, label: gold.label, diffs, perfect: diffs.length === 0 };
}

// ============================================================
// DB comparison (Scout vs current DB values)
// ============================================================

function compareToDb(scoutResult, dbCase) {
  const diffs = [];
  const fieldMap = [
    ['formal_disposition', 'disposition'],
    ['vote_split', 'vote_split'],
    ['majority_author', 'majority_author'],
    ['dissent_authors', 'dissent_authors'],
    ['substantive_winner', 'prevailing_party'],
    ['holding', 'holding'],
    ['issue_area', 'issue_area'],
  ];

  for (const [scoutField, dbField] of fieldMap) {
    const scoutVal = scoutResult[scoutField];
    const dbVal = dbCase[dbField];

    // Skip if both null/undefined
    if (scoutVal == null && dbVal == null) continue;

    // Array comparison
    if (Array.isArray(scoutVal) || Array.isArray(dbVal)) {
      const a = JSON.stringify(scoutVal || []);
      const b = JSON.stringify(dbVal || []);
      if (a !== b) {
        diffs.push({ field: dbField, db: dbVal, scout: scoutVal });
      }
    } else if (String(scoutVal || '') !== String(dbVal || '')) {
      diffs.push({ field: dbField, db: dbVal, scout: scoutVal });
    }
  }

  return diffs;
}

// ============================================================
// Map Scout result → DB update payload
// ============================================================

function buildDbPayload(scoutResult, writeFields) {
  const payload = {};

  const fieldMap = {
    'disposition': scoutResult.formal_disposition,
    'vote_split': scoutResult.vote_split,
    'majority_author': scoutResult.majority_author,
    'dissent_authors': scoutResult.dissent_authors || [],
    'prevailing_party': scoutResult.substantive_winner,
    'practical_effect': scoutResult.practical_effect,
    'holding': scoutResult.holding,
    'issue_area': scoutResult.issue_area,
  };

  // Derive case_type from opinion_type
  if (scoutResult.opinion_type === 'DIG') {
    fieldMap['case_type'] = 'procedural';
  } else if (scoutResult.formal_disposition === 'GVR') {
    fieldMap['case_type'] = 'merits'; // GVR is technically cert-stage but we treat as merits
  } else {
    fieldMap['case_type'] = 'merits';
  }

  // Derive merits_reached
  fieldMap['merits_reached'] = scoutResult.opinion_type !== 'DIG';

  // Metadata
  const meta = {
    'fact_extraction_confidence': computeOverallConfidence(scoutResult.fact_confidence),
    'low_confidence_reason': scoutResult.review_reason,
    'prompt_version': SCOUT_PROMPT_VERSION,
  };

  // Apply write filter if specified
  const allowedFields = writeFields ? new Set(writeFields) : null;

  for (const [field, value] of Object.entries(fieldMap)) {
    if (!allowedFields || allowedFields.has(field)) {
      payload[field] = value;
    }
  }

  // Always include metadata
  Object.assign(payload, meta);

  return payload;
}

function computeOverallConfidence(conf) {
  if (!conf) return 'low';
  const vals = Object.values(conf);
  if (vals.includes('low')) return 'low';
  if (vals.includes('medium')) return 'medium';
  return 'high';
}

// ============================================================
// Main
// ============================================================

async function main() {
  const opts = parseArgs();

  // Validate environment
  const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_TEST_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_TEST_SERVICE_KEY;
  const perplexityKey = process.env.PERPLEXITY_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  if (!perplexityKey) {
    console.error('Missing PERPLEXITY_API_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const perplexity = new PerplexityClient(perplexityKey, {
    model: opts.model || 'sonar',
  });

  // Budget guard — halt if daily spend already near limit
  if (!opts.dryRun) {
    const { data: budget } = await supabase
      .from('budgets')
      .select('spent_usd')
      .eq('day', new Date().toISOString().slice(0, 10))
      .maybeSingle();
    const spent = budget?.spent_usd || 0;
    if (spent > 4.50) {
      console.error(`Budget guard: $${spent.toFixed(2)} already spent today (limit $5). Halting.`);
      process.exit(1);
    }
    console.log(`Budget check: $${spent.toFixed(2)} spent today`);
  }

  // Header
  console.log('='.repeat(60));
  console.log('SCOTUS Scout — Perplexity Fact Extraction');
  console.log(`  Prompt: ${SCOUT_PROMPT_VERSION}`);
  console.log(`  Mode: ${opts.dryRun ? 'DRY RUN (no DB writes)' : 'LIVE'}`);
  if (opts.writeFields) console.log(`  Write fields: ${opts.writeFields.join(', ')}`);
  if (opts.goldSet) console.log('  Target: Gold set');
  if (opts.ids) console.log(`  Target: IDs [${opts.ids.join(', ')}]`);
  if (opts.limit) console.log(`  Limit: ${opts.limit}`);
  if (opts.skipOyez) console.log('  Oyez: DISABLED (--skip-oyez)');
  console.log('='.repeat(60));

  // Fetch cases
  const cases = await fetchCases(supabase, opts);
  console.log(`\nFetched ${cases.length} cases\n`);

  if (cases.length === 0) {
    console.log('No cases to process. Exiting.');
    return;
  }

  // Cost warning for large runs (dry-run still makes real API calls)
  if (opts.all && cases.length > 20) {
    const estCost = (cases.length * 0.005).toFixed(2);
    console.log(`\n⚠️  --all will process ${cases.length} cases, estimated cost: $${estCost}`);
    if (opts.dryRun) console.log('   Note: --dry-run still makes real Perplexity API calls (skips DB writes only)');
    console.log('   Add --limit=N to cap. Proceeding in 5 seconds...\n');
    await new Promise(r => setTimeout(r, 5000));
  }

  // Process each case
  const startTime = Date.now();
  const results = [];
  const stats = { ok: 0, uncertain: 0, failed: 0, parseError: 0, totalCost: 0, written: 0 };
  const crossCheckStats = {
    syllabus: { extracted: 0, no_syllabus: 0, ambiguous: 0, no_match: 0, override_applied: 0 },
    gpt: { triggered: 0, dissenters_replaced: 0, skipped_no_key: 0, error: 0 },
    regex_postcheck: { augmented: 0, no_additional: 0 },
    oyez: { hit: 0, miss: 0, error: 0, skipped: 0 },
  };
  const overrides = {
    disposition_from_syllabus: 0, dissenters_from_gpt: 0, dissenters_augmented_regex: 0,
    dissenters_merged_oyez: 0, vote_split_filled_oyez: 0, author_filled_oyez: 0,
  };
  const guardrail_blocks = {
    syllabus_no_syllabus: [], syllabus_no_end: [], syllabus_boundary_ambiguous: [],
    syllabus_no_match: [], syllabus_multiple_dispositions: [], syllabus_in_quotes: [],
    syllabus_unmapped: [],
    gpt_names_invalid: [], gpt_count_inconsistent: [],
    oyez_decisions_null: [], oyez_multiple_decisions: [], oyez_author_ambiguous: [],
    oyez_vote_sum_invalid: [],
  };
  const disagreements = {
    disposition_scout_vs_syllabus: [], dissenters_scout_vs_gpt: [], dissenters_scout_vs_oyez: [],
  };

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];

    // Runtime guard
    if (Date.now() - startTime > RUNTIME_LIMIT_MS) {
      console.log('\nRuntime limit reached. Stopping.');
      break;
    }

    console.log(`[${i + 1}/${cases.length}] ${c.case_name_short || c.case_name} (ID: ${c.id})`);

    // Build prompt
    const prompt = buildScoutPrompt(c);

    // Query Perplexity
    let rawContent, usage, citations;
    try {
      const resp = await perplexity.research(prompt, {
        systemPrompt: SCOUT_SYSTEM_PROMPT,
        temperature: 0.2,
        maxTokens: 2000,
      });
      rawContent = resp.content;
      usage = resp.usage;
      citations = resp.citations || [];
    } catch (err) {
      console.log(`  API error: ${err.message}`);
      results.push({ caseId: c.id, label: c.case_name_short, status: 'failed', error: err.message });
      stats.failed++;
      continue;
    }

    let cost = perplexity.calculateCost(usage);
    stats.totalCost += cost;

    // Parse
    const { parsed, parseError } = parseScoutResponse(rawContent, citations);
    if (parseError) {
      console.log(`  Parse error: ${parseError}`);
      results.push({ caseId: c.id, label: c.case_name_short, status: 'failed', error: parseError, rawContent });
      stats.parseError++;
      continue;
    }

    // ---- LAYER 1: SYLLABUS DISPOSITION EXTRACTION ----
    // Deterministic regex from opinion text in DB — overrides Scout when deterministic
    try {
      const { data: opinionRow } = await supabase
        .from('scotus_opinions')
        .select('opinion_full_text')
        .eq('case_id', c.id)
        .maybeSingle();

      if (opinionRow?.opinion_full_text) {
        const syllResult = extractDispositionFromSyllabus(opinionRow.opinion_full_text);
        crossCheckStats.syllabus[syllResult.confidence === 'syllabus_deterministic' ? 'extracted' : syllResult.confidence === 'no_syllabus' || syllResult.confidence === 'no_syllabus_end' ? 'no_syllabus' : syllResult.confidence === 'no_match' ? 'no_match' : 'ambiguous']++;

        if (syllResult.disposition && syllResult.confidence === 'syllabus_deterministic') {
          if (parsed.formal_disposition !== syllResult.disposition) {
            disagreements.disposition_scout_vs_syllabus.push({
              caseId: c.id, scout: parsed.formal_disposition, syllabus: syllResult.disposition,
            });
            console.log(`  Syllabus: Scout="${parsed.formal_disposition}" → Syllabus="${syllResult.disposition}" (overriding)`);
            parsed.formal_disposition = syllResult.disposition;
            overrides.disposition_from_syllabus++;
          }
          crossCheckStats.syllabus.override_applied++;
        } else if (syllResult.confidence !== 'syllabus_deterministic' && syllResult.disposition === null) {
          // Log guardrail blocks by type
          const blockKey = `syllabus_${syllResult.confidence}`;
          if (guardrail_blocks[blockKey]) {
            guardrail_blocks[blockKey].push({ caseId: c.id, ...(syllResult.details || {}) });
          }
        }
      } else {
        crossCheckStats.syllabus.no_syllabus++;
      }
    } catch (syllErr) {
      console.log(`  Syllabus extraction error: ${syllErr.message}`);
    }

    // ---- LAYER 2: GPT + REGEX DISSENTER CROSS-CHECK ----
    const SCOTUS_JUSTICES = new Set([
      'Roberts', 'Thomas', 'Alito', 'Sotomayor', 'Kagan', 'Gorsuch', 'Kavanaugh', 'Barrett', 'Jackson',
    ]);

    // Store the header text for regex post-check (extracted during GPT cross-check)
    let opinionHeaderText = null;

    if (process.env.OPENAI_API_KEY) {
      const scoutDissenters = parsed.dissent_authors || [];
      const voteParts = parsed.vote_split ? parsed.vote_split.split('-').map(Number) : [];
      const minorityCount = voteParts.length === 2 ? Math.min(voteParts[0], voteParts[1]) : -1;
      const needsCrossCheck =
        (minorityCount > 0 && scoutDissenters.length !== minorityCount) ||
        (minorityCount > 0 && scoutDissenters.length === 0) ||
        (!parsed.vote_split && scoutDissenters.length === 0) ||
        (!parsed.vote_split);

      if (needsCrossCheck) {
        crossCheckStats.gpt.triggered++;
        try {
          const gptResult = await crossCheckDissentersFromOpinion(supabase, c.id, process.env.OPENAI_API_KEY);
          if (gptResult && gptResult.dissenters && gptResult.dissenters.length > 0) {
            const validDissenters = gptResult.dissenters.filter(n => SCOTUS_JUSTICES.has(n));
            const invalidNames = gptResult.dissenters.filter(n => !SCOTUS_JUSTICES.has(n));
            if (invalidNames.length > 0) {
              guardrail_blocks.gpt_names_invalid.push({ caseId: c.id, invalidNames });
            }
            if (validDissenters.length > 0) {
              if (JSON.stringify(scoutDissenters.sort()) !== JSON.stringify(validDissenters.sort())) {
                disagreements.dissenters_scout_vs_gpt.push({
                  caseId: c.id, scout: scoutDissenters, gpt: validDissenters,
                });
              }
              console.log(`  GPT cross-check: Scout=[${scoutDissenters.join(',')}] → GPT=[${validDissenters.join(',')}] (using GPT)`);
              parsed.dissent_authors = validDissenters;
              overrides.dissenters_from_gpt++;
              crossCheckStats.gpt.dissenters_replaced++;
            }
          }
          // Save header text for regex post-check
          opinionHeaderText = gptResult?._headerText || null;
        } catch (gptErr) {
          console.log(`  GPT cross-check failed: ${gptErr.message}`);
          crossCheckStats.gpt.error++;
        }
      }
    } else {
      crossCheckStats.gpt.skipped_no_key++;
    }

    // ---- REGEX POST-CHECK: augment GPT dissenters with deterministic extraction ----
    // Also runs independently if GPT didn't trigger but we have opinion text
    if (!opinionHeaderText) {
      // Fetch header text if GPT didn't run
      try {
        const { data: opRow } = await supabase
          .from('scotus_opinions')
          .select('opinion_full_text')
          .eq('case_id', c.id)
          .maybeSingle();
        if (opRow?.opinion_full_text) {
          const lines = opRow.opinion_full_text.split('\n').slice(0, 300);
          const headerLines = [];
          for (let li = 0; li < lines.length; li++) {
            if (lines[li].match(/deliver|dissent|concurr|joined|filed an opinion|JUSTICE\s+\w+/i) && lines[li].trim().length > 5) {
              for (let j = Math.max(0, li - 1); j <= Math.min(lines.length - 1, li + 2); j++) {
                const ctx = lines[j].trim();
                if (ctx.length > 3 && !headerLines.includes(ctx)) headerLines.push(ctx);
              }
            }
          }
          opinionHeaderText = headerLines.join('\n');
        }
      } catch (_) { /* ignore */ }
    }

    if (opinionHeaderText) {
      const regexDissenters = extractDissentersFromHeader(opinionHeaderText, SCOTUS_JUSTICES);
      const currentDissenters = new Set(parsed.dissent_authors || []);
      const newFromRegex = regexDissenters.filter(n => !currentDissenters.has(n));

      if (newFromRegex.length > 0) {
        // Consistency check: would augmented count exceed vote split minority?
        const voteParts = parsed.vote_split ? parsed.vote_split.split('-').map(Number) : [];
        const minorityCount = voteParts.length === 2 ? Math.min(voteParts[0], voteParts[1]) : -1;
        const augmentedCount = currentDissenters.size + newFromRegex.length;

        if (minorityCount > 0 && augmentedCount > minorityCount) {
          // BLOCK — count exceeds vote split
          guardrail_blocks.gpt_count_inconsistent.push({
            caseId: c.id, augmentedCount, minorityCount,
          });
          console.log(`  Regex post-check: BLOCKED — ${augmentedCount} dissenters > ${minorityCount} minority (vote_split=${parsed.vote_split})`);
        } else {
          // Augment
          for (const n of newFromRegex) currentDissenters.add(n);
          parsed.dissent_authors = [...currentDissenters];
          overrides.dissenters_augmented_regex++;
          crossCheckStats.regex_postcheck.augmented++;
          console.log(`  Regex post-check: added [${newFromRegex.join(',')}] → dissenters=[${parsed.dissent_authors.join(',')}]`);
        }
      } else {
        crossCheckStats.regex_postcheck.no_additional++;
      }
    }

    // ---- LAYER 3: OYEZ CORROBORATION ----
    if (opts.skipOyez) {
      crossCheckStats.oyez.skipped++;
    } else if (c.term && c.docket_number) {
      try {
        const oyezResult = await fetchOyezCase(c.term, c.docket_number, { timeoutMs: 10000 });
        if (!oyezResult) {
          crossCheckStats.oyez.miss++;
          guardrail_blocks.oyez_decisions_null.push({ caseId: c.id, term: c.term, docket: c.docket_number });
        } else if (oyezResult._blocked) {
          crossCheckStats.oyez.miss++;
          if (oyezResult._blocked === 'multiple_decisions') {
            guardrail_blocks.oyez_multiple_decisions.push({ caseId: c.id });
          }
        } else {
          crossCheckStats.oyez.hit++;
          // MERGE dissenters (never override — only add missing)
          if (oyezResult.dissentAuthors && oyezResult.dissentAuthors.length > 0) {
            const currentDiss = new Set(parsed.dissent_authors || []);
            const oyezNew = oyezResult.dissentAuthors.filter(n => !currentDiss.has(n));
            if (oyezNew.length > 0) {
              if (JSON.stringify([...(parsed.dissent_authors || [])].sort()) !== JSON.stringify(oyezResult.dissentAuthors.sort())) {
                disagreements.dissenters_scout_vs_oyez.push({
                  caseId: c.id, scout: parsed.dissent_authors || [], oyez: oyezResult.dissentAuthors,
                });
              }
              for (const n of oyezNew) currentDiss.add(n);
              parsed.dissent_authors = [...currentDiss];
              overrides.dissenters_merged_oyez++;
              console.log(`  Oyez: merged dissenters [${oyezNew.join(',')}]`);
            }
          }
          // FILL vote_split if Scout missing
          if (!parsed.vote_split && oyezResult.voteSplit) {
            parsed.vote_split = oyezResult.voteSplit;
            overrides.vote_split_filled_oyez++;
            console.log(`  Oyez: filled vote_split=${oyezResult.voteSplit}`);
          }
          // FILL majority_author if Scout missing
          if (!parsed.majority_author && oyezResult.majorityAuthor) {
            parsed.majority_author = oyezResult.majorityAuthor;
            overrides.author_filled_oyez++;
            console.log(`  Oyez: filled majority_author=${oyezResult.majorityAuthor}`);
          }
        }
        // Polite delay for Oyez API
        await new Promise(r => setTimeout(r, 1000));
      } catch (oyezErr) {
        crossCheckStats.oyez.error++;
        console.log(`  Oyez error: ${oyezErr.message}`);
      }
    }

    // Validate
    const { result: validated, issues, isValid } = validateScoutResult(parsed);

    // Stats
    stats[validated.status]++;

    // Gold set comparison
    const goldComp = compareToGoldSet(validated, c.id);

    // DB comparison
    const dbDiffs = compareToDb(validated, c);

    // Print summary
    const statusIcon = validated.status === 'ok' ? '+' : validated.status === 'uncertain' ? '?' : 'X';
    console.log(`  [${statusIcon}] status=${validated.status}, disposition=${validated.formal_disposition}, vote=${validated.vote_split}, author=${validated.majority_author}, cost=$${cost.toFixed(4)}`);

    if (issues.length > 0) {
      console.log(`  Issues: ${issues.join('; ')}`);
    }

    if (goldComp) {
      if (goldComp.perfect) {
        console.log(`  Gold: MATCH (${goldComp.label})`);
      } else {
        console.log(`  Gold: MISMATCH (${goldComp.label})`);
        for (const d of goldComp.diffs) {
          console.log(`    ${d.field}: gold="${JSON.stringify(d.gold)}" scout="${JSON.stringify(d.scout)}"`);
        }
      }
    }

    if (dbDiffs.length > 0) {
      console.log(`  DB diffs: ${dbDiffs.length} fields differ`);
      for (const d of dbDiffs) {
        console.log(`    ${d.field}: db="${d.db}" scout="${d.scout}"`);
      }
    }

    if (opts.showSources && validated.source_urls.length > 0) {
      console.log(`  Sources (${validated._actual_source_tiers.map(t => `T${t}`).join(',')}):`);
      for (const url of validated.source_urls) {
        console.log(`    ${url}`);
      }
    }

    // Live write
    if (!opts.dryRun && validated.status === 'ok') {
      const payload = buildDbPayload(validated, opts.writeFields);
      const { error } = await supabase
        .from('scotus_cases')
        .update(payload)
        .eq('id', c.id);

      if (error) {
        console.log(`  DB write error: ${error.message}`);
      } else {
        console.log(`  Written ${Object.keys(payload).length} fields to DB`);
        stats.written++;
      }
    }

    // Collect result
    results.push({
      caseId: c.id,
      label: c.case_name_short || c.case_name,
      status: validated.status,
      scoutResult: validated,
      goldComparison: goldComp,
      dbDiffs,
      issues,
      cost,
    });

    // Delay between calls
    if (i < cases.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_CALLS_MS));
    }
  }

  // Record cost in budgets table
  if (!opts.dryRun && stats.totalCost > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const { error: budgetErr } = await supabase.rpc('increment_budget', {
      p_day: today,
      p_cost: stats.totalCost,
      p_calls: stats.ok + stats.uncertain + stats.failed + stats.parseError,
    });
    if (budgetErr) {
      // Fallback: try upsert if RPC doesn't exist
      const { data: existing } = await supabase
        .from('budgets')
        .select('spent_usd,openai_calls')
        .eq('day', today)
        .maybeSingle();
      const { error: upsertErr } = await supabase.from('budgets').upsert({
        day: today,
        spent_usd: (existing?.spent_usd || 0) + stats.totalCost,
        openai_calls: (existing?.openai_calls || 0) + stats.ok + stats.uncertain + stats.failed + stats.parseError,
      }, { onConflict: 'day' });
      if (upsertErr) console.warn(`Budget fallback upsert failed: ${upsertErr.message}`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SCOTUS Scout Summary');
  console.log(`  OK: ${stats.ok}`);
  console.log(`  Uncertain: ${stats.uncertain}`);
  console.log(`  Failed: ${stats.failed}`);
  console.log(`  Parse errors: ${stats.parseError}`);
  console.log(`  Total cost: $${stats.totalCost.toFixed(4)}`);
  if (!opts.dryRun) console.log(`  Written: ${stats.written}`);
  console.log(`  Duration: ${Math.round((Date.now() - startTime) / 1000)}s`);

  // Cross-check stats
  console.log('\n  Cross-check stats:');
  console.log(`    Syllabus: ${crossCheckStats.syllabus.extracted} extracted, ${crossCheckStats.syllabus.override_applied} overrides, ${crossCheckStats.syllabus.no_syllabus} no_syllabus, ${crossCheckStats.syllabus.ambiguous} ambiguous, ${crossCheckStats.syllabus.no_match} no_match`);
  console.log(`    GPT: ${crossCheckStats.gpt.triggered} triggered, ${crossCheckStats.gpt.dissenters_replaced} replaced, ${crossCheckStats.gpt.error} errors`);
  console.log(`    Regex: ${crossCheckStats.regex_postcheck.augmented} augmented, ${crossCheckStats.regex_postcheck.no_additional} no_additional`);
  console.log(`    Oyez: ${crossCheckStats.oyez.hit} hits, ${crossCheckStats.oyez.miss} misses, ${crossCheckStats.oyez.error} errors, ${crossCheckStats.oyez.skipped} skipped`);

  // Override counts
  const totalOverrides = Object.values(overrides).reduce((a, b) => a + b, 0);
  if (totalOverrides > 0) {
    console.log(`\n  Overrides (${totalOverrides} total):`);
    for (const [k, v] of Object.entries(overrides)) {
      if (v > 0) console.log(`    ${k}: ${v}`);
    }
  }

  // Guardrail blocks
  const totalBlocks = Object.values(guardrail_blocks).reduce((a, arr) => a + arr.length, 0);
  if (totalBlocks > 0) {
    console.log(`\n  Guardrail blocks (${totalBlocks} total):`);
    for (const [k, arr] of Object.entries(guardrail_blocks)) {
      if (arr.length > 0) console.log(`    ${k}: ${arr.length} [IDs: ${arr.map(b => b.caseId).join(',')}]`);
    }
  }

  // Disagreements
  const totalDisagreements = Object.values(disagreements).reduce((a, arr) => a + arr.length, 0);
  if (totalDisagreements > 0) {
    console.log(`\n  Disagreements (${totalDisagreements} total):`);
    for (const [k, arr] of Object.entries(disagreements)) {
      if (arr.length > 0) console.log(`    ${k}: ${arr.length}`);
    }
  }

  // Gold set summary
  const goldResults = results.filter(r => r.goldComparison);
  if (goldResults.length > 0) {
    const perfect = goldResults.filter(r => r.goldComparison.perfect).length;
    console.log(`  Gold set: ${perfect}/${goldResults.length} perfect match`);
    const mismatches = goldResults.filter(r => !r.goldComparison.perfect);
    if (mismatches.length > 0) {
      console.log('  Gold mismatches:');
      for (const m of mismatches) {
        for (const d of m.goldComparison.diffs) {
          console.log(`    ${m.label} — ${d.field}: gold="${JSON.stringify(d.gold)}" scout="${JSON.stringify(d.scout)}"`);
        }
      }
    }
  }

  console.log('='.repeat(60));

  // Output JSON
  if (opts.outputJson) {
    const outPath = resolve(process.cwd(), opts.outputJson);
    writeFileSync(outPath, JSON.stringify({ stats, crossCheckStats, overrides, guardrail_blocks, disagreements, results }, null, 2));
    console.log(`\nResults written to ${outPath}`);
  }

  // Exit code
  if (opts.failOnUncertain && stats.uncertain > 0) {
    console.log('\n--fail-on-uncertain: exiting with code 1');
    process.exit(1);
  }
  if (stats.failed > 0 || stats.parseError > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
