#!/usr/bin/env node
/**
 * SCOTUS Scout Unit Tests
 *
 * Tests scout-parser, scout-validator, and scout-prompt without API calls.
 * Validates normalization, enum enforcement, consistency rules, and gold set matching.
 */

import { parseScoutResponse, VALID_DISPOSITIONS, VALID_OPINION_TYPES, VALID_ISSUE_AREAS } from '../scripts/scotus/scout-parser.js';
import { validateScoutResult } from '../scripts/scotus/scout-validator.js';
import { buildScoutPrompt, SCOUT_PROMPT_VERSION, SCOUT_SYSTEM_PROMPT } from '../scripts/scotus/scout-prompt.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function section(name) {
  console.log(`\n--- ${name} ---`);
}

// ============================================================
// 1. Parser Tests
// ============================================================

section('Parser: valid JSON');
{
  const raw = JSON.stringify({
    status: 'ok',
    formal_disposition: 'affirmed',
    formal_disposition_detail: null,
    opinion_type: 'majority',
    vote_split: '9-0',
    majority_author: 'Gorsuch',
    dissent_authors: [],
    substantive_winner: 'Consumers',
    practical_effect: 'Test',
    holding: 'Test holding',
    issue_area: 'federal_regulation',
    case_citation: '603 U.S. ___ (2024)',
    fact_confidence: {
      formal_disposition: 'high',
      vote_split: 'high',
      majority_author: 'high',
      dissent_authors: 'high',
      substantive_winner: 'high',
    },
    source_tiers_used: [1, 2],
    source_urls: ['https://supremecourt.gov/test'],
  });

  const { parsed, parseError } = parseScoutResponse(raw, ['https://scotusblog.com/case']);
  assert(parseError === null, 'No parse error for valid JSON');
  assert(parsed.status === 'ok', 'Status preserved');
  assert(parsed.formal_disposition === 'affirmed', 'Disposition preserved');
  assert(parsed.vote_split === '9-0', 'Vote split preserved');
  assert(parsed.majority_author === 'Gorsuch', 'Author preserved');
  assert(parsed.dissent_authors.length === 0, 'Empty dissent');
  assert(parsed.source_urls.includes('https://scotusblog.com/case'), 'Citation merged');
  assert(parsed.source_urls.includes('https://supremecourt.gov/test'), 'JSON URL included');
}

section('Parser: markdown-wrapped JSON');
{
  const raw = '```json\n{"status":"ok","formal_disposition":"reversed","vote_split":"7-2","majority_author":"Jackson","dissent_authors":["Gorsuch"],"substantive_winner":"gov","practical_effect":"test","holding":"test","issue_area":"other","case_citation":null,"fact_confidence":{"formal_disposition":"high","vote_split":"high","majority_author":"high","dissent_authors":"high","substantive_winner":"medium"},"source_tiers_used":[2],"source_urls":[]}\n```';
  const { parsed, parseError } = parseScoutResponse(raw);
  assert(parseError === null, 'Strips markdown code blocks');
  assert(parsed.formal_disposition === 'reversed', 'Disposition from markdown-wrapped');
}

section('Parser: disposition aliases');
{
  const makeRaw = (disp) => JSON.stringify({
    status: 'ok', formal_disposition: disp, vote_split: '9-0', majority_author: 'Roberts',
    dissent_authors: [], substantive_winner: 'test', practical_effect: 'test',
    holding: 'test', issue_area: 'other', source_tiers_used: [1], source_urls: [],
    fact_confidence: { formal_disposition: 'high', vote_split: 'high', majority_author: 'high', dissent_authors: 'high', substantive_winner: 'high' },
  });

  const aliases = [
    ['affirm', 'affirmed'],
    ['reverse', 'reversed'],
    ['vacate', 'vacated'],
    ['reversed and remanded', 'reversed_and_remanded'],
    ['vacated and remanded', 'vacated_and_remanded'],
    ['granted, vacated, and remanded', 'GVR'],
    ['gvr', 'GVR'],
  ];

  for (const [input, expected] of aliases) {
    const { parsed } = parseScoutResponse(makeRaw(input));
    assert(parsed.formal_disposition === expected, `"${input}" → "${expected}" (got "${parsed.formal_disposition}")`);
  }
}

section('Parser: justice name normalization');
{
  const makeRaw = (author, dissenters) => JSON.stringify({
    status: 'ok', formal_disposition: 'affirmed', vote_split: '5-4',
    majority_author: author, dissent_authors: dissenters,
    substantive_winner: 'test', practical_effect: 'test', holding: 'test',
    issue_area: 'other', source_tiers_used: [1], source_urls: [],
    fact_confidence: { formal_disposition: 'high', vote_split: 'high', majority_author: 'high', dissent_authors: 'high', substantive_winner: 'high' },
  });

  const { parsed } = parseScoutResponse(makeRaw('Samuel Alito', ['Sonia Sotomayor', 'Elena Kagan', 'Ketanji Brown Jackson', 'Neil Gorsuch']));
  assert(parsed.majority_author === 'Alito', `Full name → last name: got "${parsed.majority_author}"`);
  assert(parsed.dissent_authors.includes('Sotomayor'), 'Sonia Sotomayor → Sotomayor');
  assert(parsed.dissent_authors.includes('Kagan'), 'Elena Kagan → Kagan');
  assert(parsed.dissent_authors.includes('Jackson'), 'Ketanji Brown Jackson → Jackson');
  assert(parsed.dissent_authors.includes('Gorsuch'), 'Neil Gorsuch → Gorsuch');
}

section('Parser: vote split normalization');
{
  const makeRaw = (vs) => JSON.stringify({
    status: 'ok', formal_disposition: 'affirmed', vote_split: vs,
    majority_author: 'Roberts', dissent_authors: [],
    substantive_winner: 'test', practical_effect: 'test', holding: 'test',
    issue_area: 'other', source_tiers_used: [1], source_urls: [],
    fact_confidence: { formal_disposition: 'high', vote_split: 'high', majority_author: 'high', dissent_authors: 'high', substantive_winner: 'high' },
  });

  const cases = [
    ['7-2', '7-2'],
    ['7–2', '7-2'],  // en-dash
    ['7—2', '7-2'],  // em-dash
    ['7 to 2', '7-2'],
    ['7:2', '7-2'],
  ];

  for (const [input, expected] of cases) {
    const { parsed } = parseScoutResponse(makeRaw(input));
    assert(parsed.vote_split === expected, `vote_split "${input}" → "${expected}" (got "${parsed.vote_split}")`);
  }
}

section('Parser: invalid JSON');
{
  const { parsed, parseError } = parseScoutResponse('This is not JSON at all');
  assert(parsed === null, 'Returns null for non-JSON');
  assert(parseError !== null, 'Returns parse error');
}

section('Parser: empty/null input');
{
  const { parsed: p1, parseError: e1 } = parseScoutResponse('');
  assert(p1 === null, 'Empty string returns null');
  const { parsed: p2, parseError: e2 } = parseScoutResponse(null);
  assert(p2 === null, 'null returns null');
}

// ============================================================
// 2. Validator Tests
// ============================================================

section('Validator: valid result stays ok');
{
  const scout = {
    status: 'ok',
    formal_disposition: 'affirmed',
    vote_split: '9-0',
    majority_author: 'Gorsuch',
    opinion_type: 'majority',
    dissent_authors: [],
    substantive_winner: 'Consumers',
    source_urls: ['https://supremecourt.gov/opinions/test'],
    source_tiers_used: [1],
    fact_confidence: { formal_disposition: 'high', vote_split: 'high', majority_author: 'high', dissent_authors: 'high', substantive_winner: 'high' },
  };
  const { result, issues, isValid } = validateScoutResult(scout);
  assert(isValid, 'Valid result is valid');
  assert(result.status === 'ok', 'Status stays ok');
  // Split vote with no dissent isn't blocking for 9-0
}

section('Validator: missing disposition → uncertain');
{
  const scout = {
    status: 'ok',
    formal_disposition: null,
    vote_split: '9-0',
    majority_author: 'Roberts',
    opinion_type: 'majority',
    dissent_authors: [],
    substantive_winner: 'test',
    source_urls: ['https://scotusblog.com/test'],
    source_tiers_used: [2],
  };
  const { result, issues } = validateScoutResult(scout);
  assert(result.status === 'uncertain', 'Missing disposition → uncertain');
  assert(issues.some(i => i.includes('formal_disposition')), 'Issue mentions disposition');
}

section('Validator: invalid enum → uncertain');
{
  const scout = {
    status: 'ok',
    formal_disposition: 'totally_made_up',
    vote_split: '9-0',
    majority_author: 'Roberts',
    opinion_type: 'majority',
    dissent_authors: [],
    substantive_winner: 'test',
    source_urls: ['https://scotusblog.com/test'],
    source_tiers_used: [2],
  };
  const { result, issues } = validateScoutResult(scout);
  assert(result.status === 'uncertain', 'Invalid enum → uncertain');
}

section('Validator: unanimous with dissenters → uncertain');
{
  const scout = {
    status: 'ok',
    formal_disposition: 'affirmed',
    vote_split: '9-0',
    majority_author: 'Roberts',
    opinion_type: 'majority',
    dissent_authors: ['Thomas'],
    substantive_winner: 'test',
    source_urls: ['https://supremecourt.gov/test'],
    source_tiers_used: [1],
  };
  const { result, issues } = validateScoutResult(scout);
  assert(result.status === 'uncertain', 'Unanimous + dissenters → uncertain');
  assert(issues.some(i => i.includes('Unanimous')), 'Issue mentions unanimous');
}

section('Validator: per curiam with author → uncertain');
{
  const scout = {
    status: 'ok',
    formal_disposition: 'affirmed',
    vote_split: '9-0',
    majority_author: 'Roberts',
    opinion_type: 'per_curiam',
    dissent_authors: [],
    substantive_winner: 'test',
    source_urls: ['https://supremecourt.gov/test'],
    source_tiers_used: [1],
  };
  const { result, issues } = validateScoutResult(scout);
  assert(result.status === 'uncertain', 'Per curiam + author → uncertain');
  assert(issues.some(i => i.includes('should be null')), 'Issue mentions should be null');
}

section('Validator: only tier 3 sources → uncertain');
{
  const scout = {
    status: 'ok',
    formal_disposition: 'affirmed',
    vote_split: '9-0',
    majority_author: 'Roberts',
    opinion_type: 'majority',
    dissent_authors: [],
    substantive_winner: 'test',
    source_urls: ['https://en.wikipedia.org/wiki/SomeCase'],
    source_tiers_used: [3],
  };
  const { result, issues } = validateScoutResult(scout);
  assert(result.status === 'uncertain', 'Only Wikipedia → uncertain');
  assert(issues.some(i => i.includes('Tier 3')), 'Issue mentions Tier 3');
}

section('Validator: vote split > 9 → uncertain');
{
  const scout = {
    status: 'ok',
    formal_disposition: 'affirmed',
    vote_split: '7-5',
    majority_author: 'Roberts',
    opinion_type: 'majority',
    dissent_authors: ['Thomas', 'Alito', 'Gorsuch', 'Kavanaugh', 'Barrett'],
    substantive_winner: 'test',
    source_urls: ['https://scotusblog.com/test'],
    source_tiers_used: [2],
  };
  const { result, issues } = validateScoutResult(scout);
  assert(issues.some(i => i.includes('sums to 12')), 'Flags vote > 9');
}

section('Validator: no sources → uncertain');
{
  const scout = {
    status: 'ok',
    formal_disposition: 'affirmed',
    vote_split: '9-0',
    majority_author: 'Roberts',
    opinion_type: 'majority',
    dissent_authors: [],
    substantive_winner: 'test',
    source_urls: [],
    source_tiers_used: [],
  };
  const { result } = validateScoutResult(scout);
  assert(result.status === 'uncertain', 'No sources → uncertain');
}

section('Validator: actual source tiers computed from URLs');
{
  const scout = {
    status: 'ok',
    formal_disposition: 'affirmed',
    vote_split: '9-0',
    majority_author: 'Roberts',
    opinion_type: 'majority',
    dissent_authors: [],
    substantive_winner: 'test',
    source_urls: [
      'https://www.supremecourt.gov/opinions/23pdf/test.pdf',
      'https://www.scotusblog.com/case-files/cases/test/',
      'https://en.wikipedia.org/wiki/Test',
    ],
    source_tiers_used: [1, 2, 3],
  };
  const { result } = validateScoutResult(scout);
  assert(result._actual_source_tiers.includes(1), 'supremecourt.gov → Tier 1');
  assert(result._actual_source_tiers.includes(2), 'scotusblog.com → Tier 2');
  assert(result._actual_source_tiers.includes(3), 'wikipedia.org → Tier 3');
}

// ============================================================
// 3. Prompt Builder Tests
// ============================================================

section('Prompt builder');
{
  const prompt = buildScoutPrompt({
    case_name: 'Kirtz v. Trans Union LLC',
    case_name_short: 'Kirtz',
    docket_number: '22-1139',
    term: '2023',
    decided_at: '2024-06-21T00:00:00Z',
  });
  assert(prompt.includes('Kirtz'), 'Contains case name');
  assert(prompt.includes('22-1139'), 'Contains docket');
  assert(prompt.includes('2023'), 'Contains term');
  assert(prompt.includes('2024-06-21'), 'Contains decided date');
  assert(prompt.includes('formal_disposition'), 'Contains field instructions');
  assert(prompt.includes('source_tiers_used'), 'Contains source tier instructions');
  assert(typeof SCOUT_PROMPT_VERSION === 'string', 'Version is string');
  assert(SCOUT_PROMPT_VERSION.startsWith('scout-'), 'Version starts with scout-');
  assert(typeof SCOUT_SYSTEM_PROMPT === 'string', 'System prompt is string');
}

// ============================================================
// 4. Simulated Gold Set: 6 Known-Bad Cases
// ============================================================

section('Simulated gold set: 6 known-bad cases (parser+validator pipeline)');
{
  // These simulate what Perplexity SHOULD return for the 6 known-bad cases
  const simulatedResponses = [
    {
      label: 'Kirtz (51)',
      goldDisposition: 'affirmed',
      goldVote: '9-0',
      goldAuthor: 'Gorsuch',
      raw: {
        status: 'ok', formal_disposition: 'affirmed', vote_split: '9-0',
        majority_author: 'Neil Gorsuch', dissent_authors: [],
        substantive_winner: 'Consumers seeking damages under FCRA',
        practical_effect: 'Consumers can sue for statutory damages',
        holding: 'Court affirmed the Third Circuit ruling',
        opinion_type: 'majority', issue_area: 'federal_regulation',
        case_citation: '601 U.S. ___ (2024)',
        fact_confidence: { formal_disposition: 'high', vote_split: 'high', majority_author: 'high', dissent_authors: 'high', substantive_winner: 'high' },
        source_tiers_used: [1, 2], source_urls: ['https://scotusblog.com/case-files/cases/kirtz/'],
      },
      citations: ['https://www.supremecourt.gov/opinions/23pdf/22-1139_nkp2.pdf'],
    },
    {
      label: 'Wullschleger (64)',
      goldDisposition: 'affirmed',
      goldVote: '9-0',
      goldAuthor: 'Kagan',
      raw: {
        status: 'ok', formal_disposition: 'affirmed', vote_split: '9-0',
        majority_author: 'Elena Kagan', dissent_authors: [],
        substantive_winner: 'Wullschleger',
        practical_effect: 'Court affirms the lower court ruling',
        holding: 'Affirmed',
        opinion_type: 'majority', issue_area: 'federal_regulation',
        case_citation: null,
        fact_confidence: { formal_disposition: 'high', vote_split: 'high', majority_author: 'high', dissent_authors: 'high', substantive_winner: 'high' },
        source_tiers_used: [2], source_urls: ['https://scotusblog.com/test'],
      },
      citations: [],
    },
    {
      label: 'Horn (137)',
      goldDisposition: 'affirmed',
      goldVote: '5-4',
      goldAuthor: 'Barrett',
      raw: {
        status: 'ok', formal_disposition: 'affirmed', vote_split: '5-4',
        majority_author: 'Amy Coney Barrett',
        dissent_authors: ['Clarence Thomas', 'Brett Kavanaugh', 'John Roberts', 'Samuel Alito'],
        substantive_winner: 'Horn',
        practical_effect: 'Test',
        holding: 'Affirmed',
        opinion_type: 'majority', issue_area: 'criminal_procedure',
        case_citation: null,
        fact_confidence: { formal_disposition: 'high', vote_split: 'high', majority_author: 'high', dissent_authors: 'high', substantive_winner: 'medium' },
        source_tiers_used: [1, 2], source_urls: ['https://supremecourt.gov/test'],
      },
      citations: ['https://www.scotusblog.com/case-files/cases/horn/'],
    },
    {
      label: 'Bowe (285)',
      goldDisposition: 'vacated',
      goldVote: '5-4',
      goldAuthor: 'Sotomayor',
      raw: {
        status: 'ok', formal_disposition: 'vacated', vote_split: '5-4',
        majority_author: 'Sonia Sotomayor',
        dissent_authors: ['Neil Gorsuch'],
        substantive_winner: 'Bowe',
        practical_effect: 'Lower court judgment vacated',
        holding: 'Vacated',
        opinion_type: 'majority', issue_area: 'criminal_procedure',
        case_citation: null,
        fact_confidence: { formal_disposition: 'high', vote_split: 'medium', majority_author: 'high', dissent_authors: 'medium', substantive_winner: 'medium' },
        source_tiers_used: [2], source_urls: ['https://scotusblog.com/test'],
      },
      citations: [],
    },
    {
      label: 'Riley (224)',
      goldDisposition: 'vacated',
      goldVote: '5-4',
      goldAuthor: 'Alito',
      raw: {
        status: 'ok', formal_disposition: 'vacated', vote_split: '5-4',
        majority_author: 'Samuel Alito',
        dissent_authors: ['Sonia Sotomayor', 'Ketanji Brown Jackson', 'Neil Gorsuch', 'Elena Kagan'],
        substantive_winner: 'Government',
        practical_effect: 'Lower court ruling vacated',
        holding: 'Vacated',
        opinion_type: 'majority', issue_area: 'criminal_procedure',
        case_citation: null,
        fact_confidence: { formal_disposition: 'high', vote_split: 'high', majority_author: 'high', dissent_authors: 'high', substantive_winner: 'high' },
        source_tiers_used: [1, 2], source_urls: ['https://supremecourt.gov/test'],
      },
      citations: ['https://scotusblog.com/case/riley'],
    },
    {
      label: 'Bondi (131)',
      goldDisposition: 'reversed',
      goldVote: '7-2',
      goldAuthor: 'Gorsuch',
      raw: {
        status: 'ok', formal_disposition: 'reversed', vote_split: '7-2',
        majority_author: 'Neil Gorsuch',
        dissent_authors: ['Clarence Thomas', 'Samuel Alito'],
        substantive_winner: 'Bondi',
        practical_effect: 'Lower court reversed',
        holding: 'Reversed',
        opinion_type: 'majority', issue_area: 'executive_power',
        case_citation: null,
        fact_confidence: { formal_disposition: 'high', vote_split: 'high', majority_author: 'high', dissent_authors: 'high', substantive_winner: 'high' },
        source_tiers_used: [2], source_urls: ['https://scotusblog.com/test'],
      },
      citations: [],
    },
  ];

  for (const sim of simulatedResponses) {
    const { parsed, parseError } = parseScoutResponse(JSON.stringify(sim.raw), sim.citations);
    assert(parseError === null, `${sim.label}: no parse error`);

    const { result, isValid } = validateScoutResult(parsed);
    assert(result.status === 'ok', `${sim.label}: status=ok`);

    // Check disposition
    assert(result.formal_disposition === sim.goldDisposition,
      `${sim.label}: disposition=${result.formal_disposition} expected=${sim.goldDisposition}`);

    // Check vote split
    assert(result.vote_split === sim.goldVote,
      `${sim.label}: vote=${result.vote_split} expected=${sim.goldVote}`);

    // Check author (normalized to last name)
    assert(result.majority_author === sim.goldAuthor,
      `${sim.label}: author=${result.majority_author} expected=${sim.goldAuthor}`);
  }
}

// ============================================================
// Summary
// ============================================================

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) process.exit(1);
