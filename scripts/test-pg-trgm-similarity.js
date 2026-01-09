// Test pg_trgm similarity with actual article titles
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testSimilarity(title1, title2, description) {
  console.log(`\n${description}`);
  console.log(`Title 1: "${title1}"`);
  console.log(`Title 2: "${title2}"`);

  const { data, error } = await supabase.rpc('exec_sql', {
    sql_string: `
      SELECT similarity(
        lower(regexp_replace('${title1}', '[^\\w\\s]', '', 'g')),
        lower(regexp_replace('${title2}', '[^\\w\\s]', '', 'g'))
      ) as similarity_score
    `
  });

  if (error) {
    // Try direct query
    const result = await supabase.from('stories').select('id').limit(1);
    console.log(`Direct query test:`, result.error ? 'Failed' : 'Success');

    // Calculate manually
    const norm1 = title1.toLowerCase().replace(/[^\w\s]/g, '');
    const norm2 = title2.toLowerCase().replace(/[^\w\s]/g, '');
    console.log(`Normalized 1: "${norm1}"`);
    console.log(`Normalized 2: "${norm2}"`);

    return null;
  }

  console.log(`Similarity score: ${data}`);
  return data;
}

async function main() {
  console.log('Testing pg_trgm similarity with actual article titles\n');
  console.log('='.repeat(70));

  // Test 1: Related Trump articles
  await testSimilarity(
    'Trump announces drug-price deal with AstraZeneca',
    'Trump threatens 100% Tariffs on Chinese Goods',
    'Test 1: Two Trump policy articles (different topics)'
  );

  // Test 2: Trump retribution articles
  await testSimilarity(
    'Trumps Retribution Revival Tour',
    'Trump Administration Uses Mortgage Fraud to Go After Adversaries',
    'Test 2: Two Trump retribution/revenge articles'
  );

  // Test 3: Letitia James articles
  await testSimilarity(
    'Top Justice Dept Officials Werent Told in Advance of James Indictment',
    'Trump Administration Uses Mortgage Fraud to Go After Adversaries',
    'Test 3: Two justice/legal articles'
  );

  // Test 4: Nearly identical titles
  await testSimilarity(
    'Trump announces drug-price deal with AstraZeneca',
    'Trump announces drug price deal with AstraZeneca',
    'Test 4: Nearly identical titles (minor differences)'
  );

  // Test 5: Very different
  await testSimilarity(
    'Carolyn Cheeks Kilpatrick Dies',
    'Trump threatens Tariffs on Chinese Goods',
    'Test 5: Completely unrelated articles'
  );

  console.log('\n' + '='.repeat(70));
  console.log('\nExpected results:');
  console.log('- Test 1: Low similarity (0.2-0.3) - different topics');
  console.log('- Test 2: Medium similarity (0.3-0.5) - related theme');
  console.log('- Test 3: Low similarity (0.2-0.3) - loosely related');
  console.log('- Test 4: HIGH similarity (0.9+) - nearly identical');
  console.log('- Test 5: Very low similarity (0.0-0.2) - unrelated');
  console.log('\nIf all scores are 0 or very low, pg_trgm extension may not be working properly');
}

main().catch(console.error);
