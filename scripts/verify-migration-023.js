import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verify() {
  console.log('🔍 Verifying Migration 023...\n');

  // Check support tables
  const { data: errors } = await sb.from('eo_enrichment_errors').select('id').limit(1);
  const { data: costs } = await sb.from('eo_enrichment_costs').select('id').limit(1);

  console.log('📊 Support Tables:');
  console.log('  ✅ eo_enrichment_errors:', errors !== null ? 'exists' : 'MISSING');
  console.log('  ✅ eo_enrichment_costs:', costs !== null ? 'exists' : 'MISSING');

  // Check categories
  const { data: categories } = await sb.from('executive_orders').select('category').limit(10);
  const uniqueCats = [...new Set(categories.map(c => c.category))];
  console.log('\n📋 Categories Migrated:');
  console.log('  ✅', uniqueCats.join(', '));

  // Check new fields
  const { data: sample } = await sb.from('executive_orders').select('*').limit(1);
  const newFields = [
    'section_what_they_say',
    'section_what_it_means',
    'section_reality_check',
    'section_why_it_matters',
    'regions',
    'policy_areas',
    'affected_agencies',
    'action_tier',
    'action_section',
    'enriched_at',
    'prompt_version'
  ];

  console.log('\n🆕 New Fields:');
  newFields.forEach(field => {
    const exists = sample && sample.length > 0 && field in sample[0];
    console.log(`  ${exists ? '✅' : '❌'} ${field}`);
  });

  // Stats
  const { count: total } = await sb.from('executive_orders').select('*', { count: 'exact', head: true });
  const { count: unenriched } = await sb.from('executive_orders').select('*', { count: 'exact', head: true }).is('enriched_at', null);

  console.log('\n📈 Statistics:');
  console.log('  Total EOs:', total);
  console.log('  Unenriched:', unenriched);
  console.log('  Enriched:', total - unenriched);

  console.log('\n✅ Migration 023 verification complete!');
}

verify().catch(console.error);
