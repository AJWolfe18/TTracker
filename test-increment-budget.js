// Test script for increment_budget RPC function
// Run after migration 019 is applied
// Usage: node test-increment-budget.js

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testIncrementBudget() {
  console.log('Testing increment_budget RPC function...\n');

  // Get current budget before test
  const { data: beforeData, error: beforeError } = await supabase
    .from('budgets')
    .select('*')
    .eq('day', new Date().toISOString().split('T')[0])
    .single();

  if (beforeError && beforeError.code !== 'PGRST116') {
    console.error('Error fetching budget before test:', beforeError);
    return;
  }

  console.log('Budget BEFORE test:');
  console.log(beforeData || 'No budget row exists yet');
  console.log('');

  // Test 1: Call increment_budget
  console.log('Test 1: Calling increment_budget(today, 0.001, 1)...');
  const { data: rpcData, error: rpcError } = await supabase.rpc('increment_budget', {
    p_day: new Date().toISOString().split('T')[0],
    p_cost: '0.001',  // Pass as string to preserve precision
    p_calls: 1
  });

  if (rpcError) {
    console.error('❌ RPC call failed:', rpcError);
    return;
  }
  console.log('✅ RPC call succeeded\n');

  // Get budget after test
  const { data: afterData, error: afterError } = await supabase
    .from('budgets')
    .select('*')
    .eq('day', new Date().toISOString().split('T')[0])
    .single();

  if (afterError) {
    console.error('Error fetching budget after test:', afterError);
    return;
  }

  console.log('Budget AFTER test:');
  console.log(afterData);
  console.log('');

  // Verify the increment worked
  const expectedSpent = (beforeData?.spent_usd || 0) + 0.001;
  const expectedCalls = (beforeData?.openai_calls || 0) + 1;

  console.log('Verification:');
  console.log(`Expected spent_usd: $${expectedSpent.toFixed(6)}`);
  console.log(`Actual spent_usd: $${parseFloat(afterData.spent_usd).toFixed(6)}`);
  console.log(`Expected openai_calls: ${expectedCalls}`);
  console.log(`Actual openai_calls: ${afterData.openai_calls}`);
  console.log('');

  if (
    Math.abs(parseFloat(afterData.spent_usd) - expectedSpent) < 0.000001 &&
    afterData.openai_calls === expectedCalls
  ) {
    console.log('✅ Budget tracking working correctly!');
  } else {
    console.log('❌ Budget values do not match expected');
  }

  // Test 2: Call again to test accumulation
  console.log('\nTest 2: Calling increment_budget again to test accumulation...');
  await supabase.rpc('increment_budget', {
    p_day: new Date().toISOString().split('T')[0],
    p_cost: '0.002',  // Pass as string to preserve precision
    p_calls: 2
  });

  const { data: finalData } = await supabase
    .from('budgets')
    .select('*')
    .eq('day', new Date().toISOString().split('T')[0])
    .single();

  console.log('Final budget after second increment:');
  console.log(finalData);
  console.log('');

  const finalExpectedSpent = expectedSpent + 0.002;
  const finalExpectedCalls = expectedCalls + 2;

  if (
    Math.abs(parseFloat(finalData.spent_usd) - finalExpectedSpent) < 0.000001 &&
    finalData.openai_calls === finalExpectedCalls
  ) {
    console.log('✅ Budget accumulation working correctly!');
  } else {
    console.log('❌ Budget accumulation not working as expected');
  }
}

testIncrementBudget().catch(console.error);
