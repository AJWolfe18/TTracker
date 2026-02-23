import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_SERVICE_KEY);

async function deepAnalysis() {
  const { data: cases } = await supabase
    .from('scotus_cases')
    .select('id, case_name, qa_verdict, qa_issues, qa_layer_b_verdict, qa_layer_b_issues, is_public')
    .eq('enrichment_status', 'enriched')
    .limit(50);

  console.log('=== Reality Check ===');
  console.log('Total enriched:', cases.length);
  console.log();

  // Final combined verdict (what actually happened)
  console.log('FINAL qa_verdict (Layer A - what was enforced):');
  const finalVerdicts = {};
  cases.forEach(c => {
    const v = c.qa_verdict || 'none';
    finalVerdicts[v] = (finalVerdicts[v] || 0) + 1;
  });
  Object.entries(finalVerdicts).forEach(([v, count]) => {
    console.log(`  ${v}: ${count} (${((count/cases.length)*100).toFixed(0)}%)`);
  });

  console.log();
  console.log('Layer B verdict (was in SHADOW mode - logged but not enforced):');
  const bVerdicts = {};
  cases.forEach(c => {
    const v = c.qa_layer_b_verdict || 'null';
    bVerdicts[v] = (bVerdicts[v] || 0) + 1;
  });
  Object.entries(bVerdicts).forEach(([v, count]) => {
    console.log(`  ${v}: ${count} (${((count/cases.length)*100).toFixed(0)}%)`);
  });

  console.log();
  console.log('Published status:');
  const pubCounts = { public: 0, private: 0 };
  cases.forEach(c => {
    if (c.is_public) pubCounts.public++;
    else pubCounts.private++;
  });
  console.log('  is_public=true:', pubCounts.public);
  console.log('  is_public=false:', pubCounts.private);

  // What Layer B was catching
  console.log();
  console.log('=== Layer B Issue Types (what it flagged in shadow mode) ===');
  const bIssueCounts = {};
  cases.forEach(c => {
    const issues = c.qa_layer_b_issues || [];
    issues.forEach(issue => {
      if (issue && issue.type && issue.internal !== true) {
        bIssueCounts[issue.type] = (bIssueCounts[issue.type] || 0) + 1;
      }
    });
  });
  Object.entries(bIssueCounts).sort((a,b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });

  // Show some Layer B REJECTs that Layer A approved
  console.log();
  console.log('=== Cases where Layer A APPROVED but Layer B REJECTED ===');
  const disagreements = cases.filter(c =>
    c.qa_verdict === 'APPROVE' && c.qa_layer_b_verdict === 'REJECT'
  ).slice(0, 8);

  for (const c of disagreements) {
    const bIssues = (c.qa_layer_b_issues || []).filter(i => i.internal !== true);
    console.log(`Case ${c.id}: ${(c.case_name || '').substring(0, 40)}`);
    console.log(`  Layer B issues: ${bIssues.map(i => i.type).join(', ')}`);
    if (bIssues[0]?.why) console.log(`  Why: ${bIssues[0].why.substring(0, 100)}`);
    console.log(`  Published: ${c.is_public}`);
    console.log();
  }
}

deepAnalysis().catch(console.error);
