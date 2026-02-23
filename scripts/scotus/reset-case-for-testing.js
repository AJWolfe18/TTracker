/**
 * Reset a case to pending for testing Layer B integration
 * Usage: node scripts/scotus/reset-case-for-testing.js <case_id>
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const caseId = process.argv[2];
if (!caseId) {
  console.log('Usage: node scripts/scotus/reset-case-for-testing.js <case_id>');
  console.log('\nRecent enriched cases you can reset:');

  const supabase = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_SERVICE_KEY);
  const { data } = await supabase
    .from('scotus_cases')
    .select('id, case_name, enriched_at')
    .eq('enrichment_status', 'enriched')
    .order('enriched_at', { ascending: false })
    .limit(5);

  data?.forEach(c => console.log(`  ${c.id}: ${(c.case_name || '').slice(0, 50)}...`));
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_SERVICE_KEY);

// Reset the case
const { error } = await supabase
  .from('scotus_cases')
  .update({
    enrichment_status: 'pending',
    // Clear Layer B columns so we can verify they get populated
    qa_layer_b_verdict: null,
    qa_layer_b_issues: null,
    qa_layer_b_ran_at: null,
  })
  .eq('id', parseInt(caseId));

if (error) {
  console.error('Error:', error.message);
  process.exit(1);
}

console.log(`✅ Case ${caseId} reset to pending`);
console.log('\nNow run:');
console.log(`  LAYER_B_MODE=shadow node scripts/scotus/enrich-scotus.js --limit=1`);
