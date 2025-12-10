#!/usr/bin/env node
/**
 * Verify entity migration results
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function runQueries() {
  console.log('=== Entity Migration Verification ===');
  console.log('');

  // Query 1: Updated unique entity count
  const { data: articles } = await supabase.from('articles').select('entities');
  const uniqueIds = new Set();
  for (const row of articles || []) {
    for (const e of row.entities || []) {
      if (e.id) uniqueIds.add(e.id);
    }
  }
  console.log('1. Unique entity count:', uniqueIds.size);

  // Query 2: Check for invalid patterns
  const pattern = /^(US|[A-Z]{2}|ORG|LOC|EVT)-[A-Z0-9-]+$/;
  const invalidIds = [...uniqueIds].filter(id => !pattern.test(id));
  console.log('2. Invalid pattern IDs:', invalidIds.length);
  if (invalidIds.length > 0) {
    console.log('   Examples:', invalidIds.slice(0, 10));
  }

  // Query 3: Top entities inspection - sample 10 stories
  const { data: stories } = await supabase
    .from('stories')
    .select('id, primary_headline, top_entities')
    .not('top_entities', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(10);

  console.log('');
  console.log('3. Sample stories with top_entities:');
  for (const s of stories || []) {
    console.log('   Story', s.id, ':', (s.top_entities || []).slice(0, 5).join(', '));
  }

  // Query 4: Check for any remaining bad IDs
  const badIds = ['US-MAYOR', 'US-PRESIDENT', 'ORG-GOVERNMENT', 'US-FUNDING', 'LOC-MEDICARE', 'ORG-BIDEN', 'ORG-COURT'];
  const foundBadIds = badIds.filter(id => uniqueIds.has(id));
  console.log('');
  console.log('4. Remaining bad IDs in data:', foundBadIds.length === 0 ? 'None (good!)' : foundBadIds);

  // Query 5: Check consolidated entities
  const consolidatedCheck = {
    'US-JEFFRIES': uniqueIds.has('US-JEFFERIES'),
    'SA-MBS': uniqueIds.has('US-MBS') || uniqueIds.has('US-BIN-SALMAN'),
    'IL-NETANYAHU': uniqueIds.has('US-NETANYAHU'),
    'UA-ZELENSKY': uniqueIds.has('US-ZELENSKY') || uniqueIds.has('US-ZELENSKYY'),
    'ORG-DEM': uniqueIds.has('ORG-DEMOCRATS') || uniqueIds.has('ORG-DEMS'),
    'ORG-GOP': uniqueIds.has('ORG-REPUBLICANS'),
    'EVT-GOVERNMENT-SHUTDOWN': uniqueIds.has('EVT-SHUTDOWN'),
    'EVT-EPSTEIN-FILES': uniqueIds.has('EVT-EPSTEIN') || uniqueIds.has('EVT-EPSTEIN-SCANDAL'),
  };
  console.log('');
  console.log('5. Consolidation check (should all be false - old variants removed):');
  let allGood = true;
  for (const [canonical, hasBad] of Object.entries(consolidatedCheck)) {
    console.log('   ' + canonical + ': old variants exist?', hasBad ? 'YES (problem)' : 'No (good)');
    if (hasBad) allGood = false;
  }

  // Query 6: Top 20 entities by frequency
  const entityCounts = {};
  for (const row of articles || []) {
    for (const e of row.entities || []) {
      if (e.id) {
        entityCounts[e.id] = (entityCounts[e.id] || 0) + 1;
      }
    }
  }
  const sorted = Object.entries(entityCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log('');
  console.log('6. Top 20 entities by frequency:');
  for (const [id, count] of sorted) {
    console.log('   ' + id + ': ' + count);
  }

  console.log('');
  console.log('=== Summary ===');
  console.log('Unique entities: ' + uniqueIds.size + ' (target: ~700-750)');
  console.log('Invalid patterns: ' + invalidIds.length + ' (target: 0)');
  console.log('Bad IDs remaining: ' + foundBadIds.length + ' (target: 0)');
  console.log('All consolidations correct:', allGood ? 'YES' : 'NO');
}

runQueries().catch(console.error);
