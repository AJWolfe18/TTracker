#!/usr/bin/env node
/**
 * SCOTUS Cases Fetcher - ADO-86
 *
 * Fetches SCOTUS cases from CourtListener API and stores them in scotus_cases table.
 *
 * Usage:
 *   node scripts/scotus/fetch-cases.js [options]
 *
 * Options:
 *   --since=YYYY-MM-DD   Only fetch cases decided after this date
 *   --limit=N            Stop after N cases (for testing)
 *   --resume             Resume from last sync state
 *   --dry-run            Don't write to database, just log
 *
 * Environment Variables:
 *   COURTLISTENER_API_TOKEN  - Required: CourtListener API auth token
 *   SUPABASE_TEST_URL        - Required: TEST Supabase URL
 *   SUPABASE_TEST_SERVICE_KEY - Required: TEST service role key
 *
 * Run: COURTLISTENER_API_TOKEN=xxx node scripts/scotus/fetch-cases.js --limit=5
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const nodeVersion = parseInt(process.version.slice(1).split('.')[0]);
if (nodeVersion < 18) {
  console.error('Node 18+ required for native fetch');
  process.exit(1);
}

// Required env vars
const required = ['COURTLISTENER_API_TOKEN', 'SUPABASE_TEST_URL', 'SUPABASE_TEST_SERVICE_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    console.error('Set COURTLISTENER_API_TOKEN and ensure .env has Supabase TEST credentials');
    process.exit(1);
  }
}

const COURTLISTENER_TOKEN = process.env.COURTLISTENER_API_TOKEN;
const COURTLISTENER_BASE = 'https://www.courtlistener.com/api/rest/v4';
const PAGE_SIZE = 50;

// Parse CLI args
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace('--', '').split('=');
  acc[key] = val ?? true;
  return acc;
}, {});

const sinceDate = args.since || '2020-01-01';  // Default: cases from 2020+
const limitCases = args.limit ? parseInt(args.limit) : null;
const resumeFromState = args.resume === true;
const dryRun = args['dry-run'] === true;

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_TEST_URL,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

// ============================================================================
// API HELPERS
// ============================================================================

const authHeaders = {
  'Authorization': `Token ${COURTLISTENER_TOKEN}`,
  'Content-Type': 'application/json'
};

let requestCount = 0;
const RATE_LIMIT = 5000;  // per hour

async function fetchWithRetry(url, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      requestCount++;
      if (requestCount % 100 === 0) {
        console.log(`   [API] ${requestCount} requests made`);
      }

      const response = await fetch(url, { headers: authHeaders });

      if (response.status === 429) {
        const backoff = Math.pow(2, attempt) * 1000;
        console.log(`   [RATE LIMIT] Backing off ${backoff}ms (attempt ${attempt}/${maxRetries})`);
        await sleep(backoff);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await sleep(1000 * attempt);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// DATA EXTRACTION HELPERS
// ============================================================================

/**
 * Select the majority opinion author using preference order
 * Opinion types are strings like "020majority", "015lead", etc.
 * Falls back to resolving author_id via API when author_str is empty
 */
async function selectMajorityAuthor(opinions) {
  const preference = [
    /majority/i,     // 020majority, MAJORITY, etc.
    /per.?curiam/i,  // per_curiam, per curiam
    /lead/i,         // 015lead
    /plurality/i,    // 025plurality
    /combined/i      // 010combined
  ];

  for (const pattern of preference) {
    // Guard against null/undefined type
    const op = opinions.find(o => pattern.test(o.type || ''));
    if (op) {
      // Prefer author_str if available, otherwise resolve from author_id
      if (op.author_str) return op.author_str;
      if (op.author_id) {
        const name = await fetchAuthorName(op.author_id);
        if (name) return name;
      }
    }
  }

  // Fallback to first opinion
  const first = opinions[0];
  if (first?.author_str) return first.author_str;
  if (first?.author_id) return await fetchAuthorName(first.author_id);

  return null;
}

/**
 * Aggregate dissent authors (de-duped)
 * Resolves author_id via API when author_str is empty
 */
async function aggregateDissents(opinions) {
  const dissents = opinions.filter(o => /dissent/i.test(o.type || ''));
  const names = [];

  for (const op of dissents) {
    let name = op.author_str;
    if (!name && op.author_id) {
      name = await fetchAuthorName(op.author_id);
    }
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  return names;
}

/**
 * Extract syllabus from opinion plain_text
 * SCOTUS opinions have two "Syllabus" markers - skip the NOTE: and find the actual case syllabus
 */
function extractSyllabus(plainText) {
  if (!plainText) return null;

  // SCOTUS format: after "SUPREME COURT" header there's a "Syllabus" followed by case name and actual content
  // Look for pattern: Syllabus followed by case name pattern (ALL CAPS v. ALL CAPS or similar)
  // Then extract the actual summary content

  // Strategy 1: Find syllabus after "SUPREME COURT" header
  const supremeCourtIdx = plainText.indexOf('SUPREME COURT');
  if (supremeCourtIdx > 0) {
    const afterSupreme = plainText.slice(supremeCourtIdx);
    // Find "Syllabus" after SUPREME COURT, then look for the case summary
    const syllabusIdx = afterSupreme.indexOf('Syllabus');
    if (syllabusIdx > 0) {
      const afterSyllabus = afterSupreme.slice(syllabusIdx + 8);
      // Find where the actual case facts begin (after docket number and date line)
      // Pattern: "Argued ... —Decided ..." followed by actual content
      const decidedMatch = afterSyllabus.match(/Decided\s+[A-Z][a-z]+\s+\d+,\s+\d{4}\s*\n([\s\S]{100,3000}?)(?=\nHeld:|Reversed|Affirmed|Opinion of|THOMAS|ROBERTS|ALITO|SOTOMAYOR|KAGAN|GORSUCH|KAVANAUGH|BARRETT|JACKSON|$)/i);
      if (decidedMatch) {
        return decidedMatch[1].trim().replace(/\n\s+/g, ' ').slice(0, 2000);
      }
    }
  }

  // Strategy 2: Fallback - find content after docket number pattern
  const docketMatch = plainText.match(/No\.\s*\d+[–-]\d+\..*?Decided.*?\d{4}\s*\n([\s\S]{100,2000}?)(?=\nHeld:|Opinion|$)/i);
  if (docketMatch) {
    return docketMatch[1].trim().replace(/\n\s+/g, ' ').slice(0, 2000);
  }

  return null;
}

/**
 * Extract first ~500 chars as excerpt fallback
 */
function extractExcerpt(plainText, maxLength = 500) {
  if (!plainText) return null;
  return plainText.slice(0, maxLength).trim();
}

/**
 * Get the best citation from citations array
 */
function selectCitation(citations) {
  if (!citations || citations.length === 0) return null;

  // Prefer U.S. Reports citation, then S.Ct., then others
  const usReports = citations.find(c => c.reporter === 'U.S.' || c.reporter_id === 1);
  if (usReports) return `${usReports.volume} U.S. ${usReports.page}`;

  const sct = citations.find(c => c.reporter === 'S. Ct.' || c.reporter_id === 3);
  if (sct) return `${sct.volume} S. Ct. ${sct.page}`;

  // Fallback to first citation
  const first = citations[0];
  return first.citation || `${first.volume || ''} ${first.reporter || ''} ${first.page || ''}`.trim();
}

/**
 * Derive term from decided date (year the case was decided)
 */
function deriveTerm(dateStr) {
  if (!dateStr) return null;
  const year = new Date(dateStr).getFullYear();
  return isNaN(year) ? null : String(year);
}

// ============================================================================
// SYNC STATE MANAGEMENT
// ============================================================================

async function getSyncState() {
  const { data, error } = await supabase
    .from('scotus_sync_state')
    .select('*')
    .eq('id', 1)
    .single();

  if (error) {
    console.error('Failed to get sync state:', error.message);
    return null;
  }
  return data;
}

async function updateSyncState(updates) {
  if (dryRun) {
    console.log('   [DRY RUN] Would update sync state:', updates);
    return;
  }

  const { error } = await supabase
    .from('scotus_sync_state')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', 1);

  if (error) {
    console.error('Failed to update sync state:', error.message);
  }
}

// ============================================================================
// MAIN FETCH LOGIC
// ============================================================================

async function fetchDocket(docketId) {
  const url = `${COURTLISTENER_BASE}/dockets/${docketId}/`;
  try {
    return await fetchWithRetry(url);
  } catch (err) {
    console.log(`   [WARN] Failed to fetch docket ${docketId}: ${err.message}`);
    return null;
  }
}

async function fetchOpinions(clusterId) {
  const url = `${COURTLISTENER_BASE}/opinions/?cluster=${clusterId}`;
  try {
    const data = await fetchWithRetry(url);
    return data.results || [];
  } catch (err) {
    console.log(`   [WARN] Failed to fetch opinions for cluster ${clusterId}: ${err.message}`);
    return [];
  }
}

// Cache for author lookups to avoid duplicate API calls
const authorCache = new Map();

async function fetchAuthorName(authorId) {
  if (!authorId) return null;

  // Check cache first
  if (authorCache.has(authorId)) {
    return authorCache.get(authorId);
  }

  const url = `${COURTLISTENER_BASE}/people/${authorId}/`;
  try {
    const data = await fetchWithRetry(url);
    const name = data.name_last
      ? `${data.name_first || ''} ${data.name_last}`.trim()
      : null;
    authorCache.set(authorId, name);
    return name;
  } catch (err) {
    console.log(`   [WARN] Failed to fetch author ${authorId}: ${err.message}`);
    authorCache.set(authorId, null);
    return null;
  }
}

async function processCluster(cluster) {
  const clusterId = cluster.id;
  console.log(`   Processing cluster ${clusterId}: ${cluster.case_name?.slice(0, 50)}...`);

  // Fetch docket for argued_at and docket_number
  let docket = null;
  if (cluster.docket_id) {
    docket = await fetchDocket(cluster.docket_id);
    await sleep(100);  // Small delay between requests
  }

  // Fetch opinions for syllabus, author, dissents
  const opinions = await fetchOpinions(clusterId);
  await sleep(100);

  // Find the primary opinion (for syllabus/excerpt)
  const primaryOpinion = opinions.find(o =>
    /majority|lead|per.?curiam|combined/i.test(o.type || '')
  ) || opinions[0];

  const plainText = primaryOpinion?.plain_text || null;
  const syllabus = extractSyllabus(plainText);
  const excerpt = syllabus ? null : extractExcerpt(plainText);

  // Resolve authors (async - may need API calls)
  const majorityAuthor = await selectMajorityAuthor(opinions);
  const dissentAuthors = await aggregateDissents(opinions);

  // Build the case record
  const caseRecord = {
    courtlistener_cluster_id: clusterId,
    courtlistener_docket_id: cluster.docket_id || null,
    case_name: cluster.case_name,
    case_name_short: cluster.case_name_short || null,
    case_name_full: cluster.case_name_full || null,
    docket_number: docket?.docket_number || null,
    term: deriveTerm(cluster.date_filed),
    decided_at: cluster.date_filed || null,
    argued_at: docket?.date_argued || null,
    citation: selectCitation(cluster.citations),
    vote_split: null,  // SCDB data unreliable, skip for MVP
    majority_author: majorityAuthor,
    dissent_authors: dissentAuthors,
    syllabus: syllabus,
    opinion_excerpt: excerpt,
    source_url: `https://www.courtlistener.com/opinion/${clusterId}/`,
    pdf_url: primaryOpinion?.download_url || null,
    is_public: false,  // Not public by default, needs enrichment/review
    updated_at: new Date().toISOString()
  };

  if (dryRun) {
    console.log('   [DRY RUN] Would upsert:', {
      cluster_id: clusterId,
      case_name: caseRecord.case_name,
      decided_at: caseRecord.decided_at,
      majority_author: caseRecord.majority_author
    });
    return true;
  }

  // Upsert to database (idempotent on courtlistener_cluster_id)
  const { error } = await supabase
    .from('scotus_cases')
    .upsert(caseRecord, {
      onConflict: 'courtlistener_cluster_id',
      ignoreDuplicates: false
    });

  if (error) {
    console.error(`   [ERROR] Failed to upsert cluster ${clusterId}:`, error.message);
    return false;
  }

  console.log(`   [OK] Upserted case: ${caseRecord.case_name_short || caseRecord.case_name?.slice(0, 30)}`);
  return true;
}

async function fetchAllCases() {
  console.log('\n=== SCOTUS Cases Fetcher ===\n');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Since: ${sinceDate}`);
  console.log(`Limit: ${limitCases || 'none'}`);
  console.log(`Resume: ${resumeFromState}\n`);

  // Get sync state
  const syncState = await getSyncState();
  if (!syncState) {
    console.error('Could not get sync state. Is migration 066 applied?');
    return;
  }

  // Determine starting URL
  let url;
  if (resumeFromState && syncState.next_url) {
    url = syncState.next_url;
    console.log(`Resuming from: ${url}\n`);
  } else {
    const startDate = syncState.last_date_filed || sinceDate;
    url = `${COURTLISTENER_BASE}/clusters/?docket__court=scotus&date_filed__gte=${startDate}&page_size=${PAGE_SIZE}&order_by=date_filed`;
    console.log(`Starting fresh from: ${startDate}\n`);
  }

  let totalProcessed = 0;
  let maxDateSeen = syncState.last_date_filed || sinceDate;
  let successCount = 0;
  let errorCount = 0;

  while (url) {
    console.log(`\nFetching page: ${url.slice(0, 80)}...`);

    try {
      const data = await fetchWithRetry(url);

      if (!data.results || data.results.length === 0) {
        console.log('No results on this page');
        break;
      }

      console.log(`Found ${data.results.length} clusters on this page`);

      for (const cluster of data.results) {
        const success = await processCluster(cluster);
        totalProcessed++;

        if (success) successCount++;
        else errorCount++;

        // Track max date incrementally
        if (cluster.date_filed && cluster.date_filed > maxDateSeen) {
          maxDateSeen = cluster.date_filed;
        }

        // Check limit
        if (limitCases && totalProcessed >= limitCases) {
          console.log(`\nReached limit of ${limitCases} cases`);
          break;
        }

        // Small delay to be nice to the API
        await sleep(200);
      }

      // Save checkpoint after each page
      await updateSyncState({
        next_url: data.next,
        last_fetch_at: new Date().toISOString(),
        total_fetched: (syncState.total_fetched || 0) + totalProcessed
      });

      // Check if we hit the limit
      if (limitCases && totalProcessed >= limitCases) {
        break;
      }

      url = data.next;  // null when done
    } catch (err) {
      console.error(`\n[FATAL] Error fetching page: ${err.message}`);
      break;
    }
  }

  // On completion: clear next_url, finalize last_date_filed
  if (!limitCases || !url) {
    await updateSyncState({
      next_url: null,
      last_date_filed: maxDateSeen,
      last_fetch_at: new Date().toISOString()
    });
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`API requests: ${requestCount}`);
  console.log(`Max date seen: ${maxDateSeen}`);

  if (!dryRun) {
    console.log('\nTo make cases public for the frontend:');
    console.log('  UPDATE scotus_cases SET is_public = true WHERE id = X;');
  }
}

// ============================================================================
// RUN
// ============================================================================

fetchAllCases()
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
