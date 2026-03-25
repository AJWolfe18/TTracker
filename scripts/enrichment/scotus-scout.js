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

Return JSON: {"dissent_authors": ["Last1", "Last2"], "vote_split": "N-N"}
If no dissenters, return {"dissent_authors": [], "vote_split": "9-0"}

${header}`
      }
    ]
  });

  const raw = resp.choices[0].message.content.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(raw);

  const result = { dissenters: null, vote_split: null };

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
  if (opts.goldSet) console.log('  Target: Gold set (25 cases)');
  if (opts.ids) console.log(`  Target: IDs [${opts.ids.join(', ')}]`);
  if (opts.limit) console.log(`  Limit: ${opts.limit}`);
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

    // ---- GPT CROSS-CHECK: only when Scout dissenters look wrong ----
    // Trigger conditions: (a) split vote but empty dissenters, (b) dissenter count doesn't match vote
    const SCOTUS_JUSTICES = new Set([
      'Roberts', 'Thomas', 'Alito', 'Sotomayor', 'Kagan', 'Gorsuch', 'Kavanaugh', 'Barrett', 'Jackson',
    ]);
    if (process.env.OPENAI_API_KEY) {
      const scoutDissenters = parsed.dissent_authors || [];
      const voteParts = parsed.vote_split ? parsed.vote_split.split('-').map(Number) : [];
      const minorityCount = voteParts.length === 2 ? Math.min(voteParts[0], voteParts[1]) : -1;
      const needsCrossCheck =
        (minorityCount > 0 && scoutDissenters.length !== minorityCount) ||  // count mismatch
        (minorityCount > 0 && scoutDissenters.length === 0) ||               // empty on split vote
        (!parsed.vote_split && scoutDissenters.length === 0) ||              // no vote + no dissenters
        (!parsed.vote_split);                                                 // missing vote (uncertain)

      if (needsCrossCheck) {
        try {
          const gptResult = await crossCheckDissentersFromOpinion(supabase, c.id, process.env.OPENAI_API_KEY);
          if (gptResult && gptResult.dissenters && gptResult.dissenters.length > 0) {
            // Filter to actual SCOTUS justices only
            const validDissenters = gptResult.dissenters.filter(n => SCOTUS_JUSTICES.has(n));
            if (validDissenters.length > 0) {
              console.log(`  GPT cross-check: Scout=[${scoutDissenters.join(',')}] → GPT=[${validDissenters.join(',')}] (using GPT)`);
              parsed.dissent_authors = validDissenters;
            }
            // Do NOT override vote_split — GPT is unreliable on vote counts from opinion headers
          }
        } catch (gptErr) {
          console.log(`  GPT cross-check failed: ${gptErr.message}`);
        }
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
    writeFileSync(outPath, JSON.stringify({ stats, results }, null, 2));
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
