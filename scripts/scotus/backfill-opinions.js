#!/usr/bin/env node
/**
 * Backfill scotus_opinions for existing cases
 *
 * Usage: COURTLISTENER_API_TOKEN=xxx node scripts/scotus/backfill-opinions.js --limit=50
 *
 * This script:
 * 1. Queries scotus_cases WHERE source_data_version != 'v2-full-opinion'
 * 2. For each case, fetches opinions from CourtListener using courtlistener_cluster_id
 * 3. Builds canonical text with buildCanonicalOpinionText()
 * 4. Upserts into scotus_opinions
 * 5. Updates scotus_cases.source_data_version = 'v2-full-opinion'
 *
 * IMPORTANT: Does NOT modify enrichment fields - preserves existing enrichment state
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { sha256Hex, buildCanonicalOpinionText, upsertOpinionIfChanged } from './opinion-utils.js';
dotenv.config();

const COURTLISTENER_TOKEN = process.env.COURTLISTENER_API_TOKEN;
const COURTLISTENER_BASE = 'https://www.courtlistener.com/api/rest/v4';

// Parse CLI args
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace('--', '').split('=');
  acc[key] = val ?? true;
  return acc;
}, {});

const limit = args.limit ? parseInt(args.limit) : 10;
const dryRun = args['dry-run'] === true;
const useProd = args.prod === true;

// Environment detection (same pattern as other scripts)
const supabaseUrl = useProd
  ? process.env.SUPABASE_URL
  : process.env.SUPABASE_TEST_URL;
const supabaseKey = useProd
  ? process.env.SUPABASE_SERVICE_KEY
  : process.env.SUPABASE_TEST_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(`Missing Supabase credentials for ${useProd ? 'PROD' : 'TEST'}`);
  process.exit(1);
}

if (!COURTLISTENER_TOKEN) {
  console.error('Missing COURTLISTENER_API_TOKEN environment variable');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log(`Environment: ${useProd ? 'PROD' : 'TEST'}`);

async function fetchOpinions(clusterId) {
  const allResults = [];
  let url = `${COURTLISTENER_BASE}/opinions/?cluster=${clusterId}`;

  // Handle pagination (CourtListener can paginate large result sets)
  while (url) {
    const response = await fetch(url, {
      headers: { 'Authorization': `Token ${COURTLISTENER_TOKEN}` }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    allResults.push(...(data.results || []));
    url = data.next || null;  // Follow pagination
  }

  return allResults;
}

async function backfillCase(scotusCase) {
  console.log(`Processing: ${scotusCase.case_name}`);

  // Fetch opinions from CourtListener
  const opinions = await fetchOpinions(scotusCase.courtlistener_cluster_id);
  if (!opinions.length) {
    console.log(`   [SKIP] No opinions found`);
    return false;
  }

  const canonicalText = buildCanonicalOpinionText(opinions);
  if (!canonicalText) {
    console.log(`   [SKIP] No text extracted`);
    return false;
  }

  console.log(`   [OK] Built canonical text: ${canonicalText.length} chars`);

  if (dryRun) {
    const hash = sha256Hex(canonicalText);
    console.log(`   [DRY RUN] Would upsert (hash: ${hash.slice(0, 8)}...)`);
    return true;
  }

  // Upsert only if changed (uses content_hash)
  const result = await upsertOpinionIfChanged(supabase, scotusCase.id, canonicalText);

  if (result.error) {
    console.error(`   [ERROR] scotus_opinions upsert: ${result.error}`);
    return false;
  }

  if (!result.changed) {
    console.log(`   [SKIP] Content unchanged (hash match)`);
    // Still ensure version is set (idempotent)
    const { error: versionErr } = await supabase
      .from('scotus_cases')
      .update({ source_data_version: 'v2-full-opinion' })
      .eq('id', scotusCase.id);
    if (versionErr) {
      console.error(`   [ERROR] version update: ${versionErr.message}`);
      return false;
    }
    return true;
  }

  // Update main table version (DO NOT touch enrichment fields)
  const { error: caseErr } = await supabase
    .from('scotus_cases')
    .update({ source_data_version: 'v2-full-opinion' })
    .eq('id', scotusCase.id);

  if (caseErr) {
    console.error(`   [ERROR] scotus_cases update: ${caseErr.message}`);
    return false;
  }

  console.log(`   [OK] Backfilled (hash: ${result.content_hash.slice(0, 8)}...)`);
  return true;
}

async function main() {
  console.log(`\n=== Backfill SCOTUS Opinions ===\n`);
  console.log(`Limit: ${limit}, Dry run: ${dryRun}\n`);

  // Query cases needing backfill (recent cases first - more likely to have full text)
  const { data: cases, error } = await supabase
    .from('scotus_cases')
    .select('id, case_name, courtlistener_cluster_id, source_data_version, decided_at')
    .or('source_data_version.neq.v2-full-opinion,source_data_version.is.null')
    .not('courtlistener_cluster_id', 'is', null)
    .order('decided_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Query error:', error.message);
    process.exit(1);
  }

  console.log(`Found ${cases.length} cases to backfill\n`);

  let success = 0, failed = 0;
  for (const c of cases) {
    try {
      const ok = await backfillCase(c);
      if (ok) success++; else failed++;
    } catch (err) {
      console.error(`   [ERROR] ${err.message}`);
      failed++;
    }
    // Rate limiting
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n=== Done: ${success} success, ${failed} failed ===\n`);
}

main().catch(console.error);
