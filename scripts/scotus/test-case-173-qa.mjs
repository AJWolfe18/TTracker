import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { runLayerBQA, computeFinalVerdict } from '../enrichment/scotus-qa-layer-b.js';
import { runDeterministicValidators, deriveVerdict } from '../enrichment/scotus-qa-validators.js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_SERVICE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function fullQATest(caseId) {
  const { data: c } = await supabase
    .from('scotus_cases')
    .select('*')
    .eq('id', caseId)
    .single();

  console.log(`=== Full QA Pipeline Test: Case ${caseId} (${c.case_name}) ===`);
  console.log();

  // Layer A
  const layerAIssues = runDeterministicValidators({
    summary_spicy: c.summary_spicy,
    ruling_impact_level: c.ruling_impact_level,
    facts: { dissent_exists: c.dissent_exists, merits_reached: c.merits_reached, case_type: c.case_type },
    grounding: { holding: c.holding, practical_effect: c.practical_effect, evidence_quotes: c.evidence_quotes }
  });
  const layerAVerdict = deriveVerdict(layerAIssues);

  console.log('--- Layer A ---');
  console.log('Issues:', layerAIssues.map(i => `${i.type} (${i.severity}, fixable=${i.fixable})`));
  console.log('Verdict:', layerAVerdict);
  console.log();

  // Layer B
  console.log('--- Layer B (calling GPT-4o-mini...) ---');
  const layerBResult = await runLayerBQA(openai, {
    summary_spicy: c.summary_spicy,
    ruling_impact_level: c.ruling_impact_level,
    ruling_label: c.ruling_label,
    grounding: { holding: c.holding, practical_effect: c.practical_effect, evidence_quotes: c.evidence_quotes },
    facts: { disposition: c.disposition, prevailing_party: c.prevailing_party }
  });

  console.log('Verdict:', layerBResult.verdict);
  const nonInternalIssues = (layerBResult.issues || []).filter(i => i.internal !== true);
  console.log('Issues:', nonInternalIssues.map(i => `${i.type} (${i.severity})`));
  console.log('Dropped issues:', layerBResult.droppedIssues?.length || 0);
  if (layerBResult.droppedIssues && layerBResult.droppedIssues.length > 0) {
    layerBResult.droppedIssues.forEach(i => console.log(`  Dropped: ${i.type} - ${i.dropped_reason}`));
  }
  console.log('Error:', layerBResult.error || 'none');
  console.log();

  // Final
  const finalVerdict = computeFinalVerdict(layerAVerdict, layerBResult.verdict);
  console.log('--- Final ---');
  console.log(`Layer A: ${layerAVerdict} + Layer B: ${layerBResult.verdict} = ${finalVerdict}`);
  console.log();

  // Retry eligibility
  const allIssues = [...layerAIssues, ...(layerBResult.issues || [])];
  const hasFixableIssues = allIssues.some(i => i.fixable === true);
  console.log('--- Retry Eligibility ---');
  console.log('Has fixable issues:', hasFixableIssues);
  if (hasFixableIssues) {
    const fixDirectives = allIssues.filter(i => i.fix_directive);
    console.log('Fix directives available:', fixDirectives.length);
    fixDirectives.forEach(i => console.log(`  - ${(i.fix_directive || '').substring(0, 80)}`));
  }

  // What would happen with retry?
  console.log();
  console.log('--- Retry Analysis ---');
  if (finalVerdict === 'REJECT' && hasFixableIssues) {
    console.log('Would retry: YES - REJECT with fixable issues');
    console.log('After retry, if issue persists: Final REJECT (content not published)');
  } else if (finalVerdict === 'REVIEW') {
    console.log('Would retry: MAYBE - depends on LAYER_B_RETRY setting');
    console.log('REVIEW means human must check before publishing');
  } else {
    console.log('Would retry: NO');
  }
}

// Test multiple cases from the plan
const testCases = [173, 287, 145];
for (const caseId of testCases) {
  await fullQATest(caseId);
  console.log('\n' + '='.repeat(60) + '\n');
}
