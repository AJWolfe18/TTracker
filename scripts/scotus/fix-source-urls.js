#!/usr/bin/env node
/**
 * One-time fix script - add slugs to CourtListener source URLs
 *
 * Problem: URLs were stored as https://www.courtlistener.com/opinion/[id]/
 * CourtListener requires: https://www.courtlistener.com/opinion/[id]/[slug]/
 *
 * Run: node scripts/scotus/fix-source-urls.js
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_TEST_URL,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

function generateSlug(caseName) {
  if (!caseName) return '';
  return caseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function fixUrls() {
  // Get all cases
  const { data: cases, error } = await supabase
    .from('scotus_cases')
    .select('id, case_name, source_url, courtlistener_cluster_id')
    .not('source_url', 'is', null);

  if (error) {
    console.error('Error fetching:', error);
    return;
  }

  console.log('Total cases to check:', cases.length);

  let fixedCount = 0;
  for (const c of cases) {
    const slug = generateSlug(c.case_name);
    const expectedUrl = `https://www.courtlistener.com/opinion/${c.courtlistener_cluster_id}/${slug}/`;

    if (c.source_url !== expectedUrl) {
      const { error: updateError } = await supabase
        .from('scotus_cases')
        .update({ source_url: expectedUrl })
        .eq('id', c.id);

      if (updateError) {
        console.error(`Error updating case ${c.id}:`, updateError.message);
      } else {
        fixedCount++;
        if (fixedCount <= 3) {
          console.log(`  Fixed: ${c.case_name.slice(0, 40)}...`);
        }
      }
    }
  }

  console.log(`\nFixed ${fixedCount} URLs`);
}

fixUrls();
